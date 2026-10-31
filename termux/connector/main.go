package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/coder/websocket"
	"github.com/harvey-moeid/byga-android-mcp/termux/core"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Config struct {
	Server      string `json:"server"`
	DeviceID    string `json:"device_id"`
	Token       string `json:"token"`
	Workspace   string `json:"workspace"`
	AllowWrite  bool   `json:"allow_write"`
	BridgeToken string `json:"bridge_token,omitempty"`
}
type Job struct {
	ID        string                     `json:"job_id"`
	Tool      string                     `json:"tool"`
	Arguments map[string]json.RawMessage `json:"arguments"`
	Expires   int64                      `json:"expires_at"`
}
type Message struct {
	Type   string       `json:"type"`
	Job    Job          `json:"job"`
	JobID  string       `json:"job_id,omitempty"`
	Result *core.Result `json:"result,omitempty"`
	Error  string       `json:"error,omitempty"`
}

func configPath() string {
	if p := os.Getenv("BYGA_CONFIG"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal("HOME_REQUIRED")
	}
	return filepath.Join(home, ".config", "byga", "agent.json")
}
func load() (Config, error) {
	b, err := os.ReadFile(configPath())
	if err != nil {
		return Config{}, err
	}
	var c Config
	err = json.Unmarshal(b, &c)
	return c, err
}
func save(c Config) error {
	dir := filepath.Dir(configPath())
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	return atomicFile(configPath(), b)
}
func atomicFile(p string, b []byte) error {
	r, err := os.OpenRoot(filepath.Dir(p))
	if err != nil {
		return err
	}
	defer r.Close()
	tmp := filepath.Base(p) + ".tmp-" + random()
	f, err := r.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer r.Remove(tmp)
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return r.Rename(tmp, filepath.Base(p))
}
func random() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func validateServer(server string, local bool) error {
	u, err := url.Parse(server)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return errors.New("INVALID_SERVER_URL")
	}
	if u.Scheme != "https" && !(local && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost")) {
		return errors.New("HTTPS_REQUIRED")
	}
	return nil
}
func pair(args []string) error {
	f := flag.NewFlagSet("pair", flag.ContinueOnError)
	server := f.String("server", "", "HTTPS server origin")
	code := f.String("code", "", "One-use pairing code")
	name := f.String("name", "Android Termux", "Device name")
	workspace := f.String("workspace", "", "Restricted file directory")
	local := f.Bool("local-test", false, "Allow localhost HTTP for integration tests only")
	write := f.Bool("allow-write", false, "Opt in to approved filesystem writes")
	bridge := f.String("bridge-token", "", "Token displayed by the local Android bridge")
	if err := f.Parse(args); err != nil {
		return err
	}
	if err := validateServer(*server, *local); err != nil {
		return err
	}
	if _, err := os.Stat(configPath()); err == nil {
		return errors.New("ALREADY_PAIRED_UNPAIR_FIRST")
	}
	if *workspace == "" {
		home, _ := os.UserHomeDir()
		*workspace = filepath.Join(home, "byga-workspace")
	}
	absolute, err := filepath.Abs(*workspace)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(absolute, 0700); err != nil {
		return err
	}
	e := core.Executor{Workspace: absolute, AllowWrite: *write, BridgeToken: *bridge}
	b, _ := json.Marshal(map[string]any{"code": *code, "name": *name, "platform": "Termux / Android ARM64", "capabilities": e.Capabilities()})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", *server+"/api/pair/claim", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("REDIRECT_DENIED") }}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("PAIR_REQUEST_FAILED")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		return fmt.Errorf("PAIR_FAILED_HTTP_%d", resp.StatusCode)
	}
	var result struct {
		DeviceID string `json:"device_id"`
		Token    string `json:"token"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
		return err
	}
	if result.DeviceID == "" || len(result.Token) != 64 {
		return errors.New("INVALID_PAIR_RESPONSE")
	}
	if err = save(Config{Server: *server, DeviceID: result.DeviceID, Token: result.Token, Workspace: absolute, AllowWrite: *write, BridgeToken: *bridge}); err != nil {
		return err
	}
	fmt.Println("Pairing tersimpan. Konfirmasi perangkat di dashboard sebelum start. Device ID:", result.DeviceID)
	return nil
}

type journal struct {
	mu  sync.Mutex
	dir string
}

func (j *journal) path(id string) string {
	safe := len(id) == 36 && !strings.ContainsAny(id, "/\\.")
	if !safe {
		return ""
	}
	return filepath.Join(j.dir, id+".json")
}
func (j *journal) read(id string) (Message, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	p := j.path(id)
	if p == "" {
		return Message{}, true
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return Message{}, false
	}
	var m Message
	if json.Unmarshal(b, &m) != nil {
		return Message{Type: "result", JobID: id, Error: "EXECUTION_STATUS_UNKNOWN"}, true
	}
	return m, true
}
func (j *journal) write(m Message) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	p := j.path(m.JobID)
	if p == "" {
		return errors.New("INVALID_JOB_ID")
	}
	return atomicFile(p, mustJSON(m))
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func connect(ctx context.Context, c Config, j *journal) error {
	u, _ := url.Parse(c.Server)
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	u.Path = "/api/device/connect"
	h := http.Header{"Authorization": []string{"Bearer " + c.Token}, "X-Device-Id": []string{c.DeviceID}}
	ws, resp, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		if resp != nil {
			return fmt.Errorf("CONNECT_HTTP_%d", resp.StatusCode)
		}
		return errors.New("CONNECT_FAILED")
	}
	defer ws.CloseNow()
	ws.SetReadLimit(65536)
	connected, cancel := context.WithCancel(ctx)
	defer cancel()
	var writeMu sync.Mutex
	send := func(m Message) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		deadline, stop := context.WithTimeout(connected, 10*time.Second)
		defer stop()
		return ws.Write(deadline, websocket.MessageText, mustJSON(m))
	}
	files, _ := os.ReadDir(j.dir)
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".json") {
			m, exists := j.read(strings.TrimSuffix(f.Name(), ".json"))
			if exists && m.Type == "result" {
				if err := send(m); err != nil {
					return err
				}
			}
		}
	}
	var jobMu sync.Mutex
	cancels := map[string]context.CancelFunc{}
	queue := make(chan Job, 50)
	var workers sync.WaitGroup
	workers.Add(1)
	go func() {
		defer workers.Done()
		executor := core.Executor{Workspace: c.Workspace, AllowWrite: c.AllowWrite, BridgeToken: c.BridgeToken}
		for {
			select {
			case <-connected.Done():
				return
			case job := <-queue:
				jobMu.Lock()
				jobCtx, stop := context.WithCancel(connected)
				cancels[job.ID] = stop
				jobMu.Unlock()
				var result core.Result
				var err error
				previous, _ := j.read(job.ID)
				if previous.Error == "CANCELLED" {
					err = errors.New("CANCELLED")
				} else if job.Expires <= time.Now().UnixMilli() {
					err = errors.New("JOB_EXPIRED")
				} else {
					deadline, deadlineCancel := context.WithDeadline(jobCtx, time.UnixMilli(job.Expires))
					result, err = executor.Run(deadline, job.Tool, job.Arguments)
					deadlineCancel()
				}
				stop()
				jobMu.Lock()
				delete(cancels, job.ID)
				jobMu.Unlock()
				m := Message{Type: "result", JobID: job.ID, Result: &result}
				if err != nil {
					m.Error = err.Error()
				}
				if err = j.write(m); err != nil {
					cancel()
					return
				}
				if send(m) != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { cancel(); workers.Wait() }()
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-connected.Done():
				return
			case <-ticker.C:
				if send(Message{Type: "heartbeat"}) != nil {
					cancel()
					return
				}
			}
		}
	}()
	for {
		_, b, err := ws.Read(connected)
		if err != nil {
			return errors.New("CONNECTION_CLOSED")
		}
		var m Message
		if json.Unmarshal(b, &m) != nil {
			return errors.New("INVALID_SERVER_MESSAGE")
		}
		switch m.Type {
		case "job":
			if m.Job.ID == "" {
				return errors.New("INVALID_JOB")
			}
			if old, exists := j.read(m.Job.ID); exists {
				if old.Type == "result" && old.Error != "EXECUTION_STATUS_UNKNOWN" {
					_ = send(old)
				}
				continue
			}
			pending := Message{Type: "result", JobID: m.Job.ID, Error: "EXECUTION_STATUS_UNKNOWN"}
			if err = j.write(pending); err != nil {
				return err
			}
			if err = send(Message{Type: "ack", JobID: m.Job.ID}); err != nil {
				return err
			}
			select {
			case queue <- m.Job:
			default:
				return errors.New("LOCAL_QUEUE_FULL")
			}
		case "cancel":
			jobMu.Lock()
			if stop := cancels[m.JobID]; stop != nil {
				stop()
			}
			jobMu.Unlock() // queued cancellation is checked through a persisted tombstone below
			_ = j.write(Message{Type: "result", JobID: m.JobID, Error: "CANCELLED"})
		case "result_ack":
			_ = j.write(Message{Type: "tombstone", JobID: m.JobID})
		}
	}
}
func controlPath() string { return filepath.Join(filepath.Dir(configPath()), "control.sock") }
func control(command string) error {
	conn, err := net.DialTimeout("unix", controlPath(), time.Second)
	if err != nil {
		return errors.New("AGENT_NOT_RUNNING")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	if _, err = conn.Write([]byte(command)); err != nil {
		return err
	}
	b, err := io.ReadAll(io.LimitReader(conn, 1024))
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}
func controlServer(ctx context.Context, stop context.CancelFunc) (net.Listener, error) {
	p := controlPath()
	if info, err := os.Lstat(p); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("CONTROL_PATH_OCCUPIED")
		}
		conn, err := net.DialTimeout("unix", p, 200*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil, errors.New("AGENT_ALREADY_RUNNING")
		}
		if err = os.Remove(p); err != nil {
			return nil, err
		}
	}
	listener, err := net.Listen("unix", p)
	if err != nil {
		return nil, err
	}
	if err = os.Chmod(p, 0600); err != nil {
		listener.Close()
		return nil, err
	}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			_ = conn.SetDeadline(time.Now().Add(time.Second))
			buffer := make([]byte, 16)
			n, _ := conn.Read(buffer)
			switch string(buffer[:n]) {
			case "stop":
				_, _ = conn.Write([]byte("Agent dihentikan"))
				stop()
			case "status":
				_, _ = conn.Write([]byte("Agent berjalan; koneksi remote dapat sedang reconnect"))
			default:
				_, _ = conn.Write([]byte("INVALID_COMMAND"))
			}
			conn.Close()
			if ctx.Err() != nil {
				return
			}
		}
	}()
	return listener, nil
}
func start() error {
	c, err := load()
	if err != nil {
		return errors.New("NOT_PAIRED")
	}
	local := strings.HasPrefix(c.Server, "http://127.0.0.1:") || strings.HasPrefix(c.Server, "http://localhost:")
	if err = validateServer(c.Server, local); err != nil {
		return err
	}
	dir := filepath.Join(filepath.Dir(configPath()), "journal")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	files, _ := os.ReadDir(dir)
	if len(files) > 10000 {
		return errors.New("JOURNAL_LIMIT_REPAIR_REQUIRED")
	}
	j := &journal{dir: dir}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	listener, err := controlServer(ctx, stop)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(controlPath())
	pidFile := filepath.Join(filepath.Dir(configPath()), "agent.pid")
	_ = atomicFile(pidFile, []byte(fmt.Sprint(os.Getpid())))
	defer os.Remove(pidFile)
	backoff := time.Second
	for ctx.Err() == nil {
		err = connect(ctx, c, j)
		if ctx.Err() != nil {
			break
		}
		log.Printf("Agent disconnected (%v); retry in %s", err, backoff)
		jitter := time.Duration(time.Now().UnixNano() % int64(time.Second))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff + jitter):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
	return nil
}
func main() {
	log.SetFlags(log.LstdFlags)
	if len(os.Args) < 2 {
		fmt.Println("BYGA Agent 1.0.0: pair | start | doctor | status | config | stop | unpair")
		return
	}
	var err error
	switch os.Args[1] {
	case "pair":
		err = pair(os.Args[2:])
	case "start":
		err = start()
	case "doctor":
		c, e := load()
		if e != nil {
			fmt.Println("Belum dipair; jalankan pair.")
		} else {
			fmt.Printf("Device: %s\nServer: %s\nWorkspace: %s\nWrite opt-in: %t\nBridge paired: %t\n", c.DeviceID, c.Server, c.Workspace, c.AllowWrite, c.BridgeToken != "")
		}
	case "status":
		err = control("status")
	case "config":
		c, e := load()
		if e != nil {
			err = e
		} else {
			c.Token = "[REDACTED]"
			if c.BridgeToken != "" {
				c.BridgeToken = "[REDACTED]"
			}
			fmt.Println(string(mustJSON(c)))
		}
	case "unpair":
		err = os.Remove(configPath())
		fmt.Println("Credential lokal dihapus. Cabut perangkat juga dari dashboard.")
	case "stop":
		err = control("stop")
	case "restart":
		_ = control("stop")
		time.Sleep(300 * time.Millisecond)
		err = start()
	default:
		err = errors.New("UNKNOWN_COMMAND")
	}
	if err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
