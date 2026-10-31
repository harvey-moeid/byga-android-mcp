package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Executor struct {
	Workspace   string
	AllowWrite  bool
	BridgeToken string
}
type Result struct {
	Stdout     string  `json:"stdout,omitempty"`
	Stderr     string  `json:"stderr,omitempty"`
	ExitCode   int     `json:"exit_code"`
	DurationMS int64   `json:"duration_ms,omitempty"`
	Content    string  `json:"content,omitempty"`
	Entries    []Entry `json:"entries,omitempty"`
	UITree     string  `json:"ui_tree,omitempty"`
	OK         bool    `json:"ok,omitempty"`
}
type Entry struct {
	Name      string `json:"name"`
	Directory bool   `json:"directory"`
	Size      int64  `json:"size"`
}
type limitBuffer struct {
	bytes.Buffer
	Limit int
}

func (b *limitBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.Limit - b.Len()
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return n, nil
}
func SafePath(path string) error {
	if path == "" || filepath.IsAbs(path) || strings.Contains(path, "\\") || strings.ContainsRune(path, 0) {
		return errors.New("INVALID_PATH")
	}
	for _, p := range strings.Split(path, "/") {
		if p == ".." {
			return errors.New("PATH_TRAVERSAL")
		}
	}
	return nil
}
func text(args map[string]json.RawMessage, key string) string {
	var v string
	_ = json.Unmarshal(args[key], &v)
	return v
}
func (e Executor) Capabilities() []string {
	c := []string{"terminal_run", "files_list", "files_read"}
	if e.AllowWrite {
		c = append(c, "files_write", "files_delete")
	}
	if e.BridgeToken != "" {
		c = append(c, "android_ui_tree", "android_tap", "android_swipe", "android_input_text", "android_press_key", "android_open_app")
	}
	return c
}
func (e Executor) Run(ctx context.Context, tool string, args map[string]json.RawMessage) (Result, error) {
	start := time.Now()
	var res Result
	var err error
	if tool == "terminal_run" {
		res, err = e.terminal(ctx, args)
	} else if strings.HasPrefix(tool, "files_") {
		res, err = e.files(tool, args)
	} else if strings.HasPrefix(tool, "android_") {
		res, err = e.bridge(ctx, tool, args)
	} else {
		err = errors.New("DEVICE_CAPABILITY_UNAVAILABLE")
	}
	res.DurationMS = time.Since(start).Milliseconds()
	return res, err
}
func (e Executor) terminal(ctx context.Context, args map[string]json.RawMessage) (Result, error) {
	name := text(args, "command")
	var argv []string
	if raw := args["args"]; raw != nil {
		if json.Unmarshal(raw, &argv) != nil {
			return Result{}, errors.New("INVALID_ARGUMENT")
		}
	}
	allowed := map[string]bool{"pwd": true, "date": true, "uname": true, "uptime": true, "whoami": true, "termux-battery-status": true}
	if !allowed[name] || (len(argv) > 0 && !(name == "uname" && len(argv) == 1 && argv[0] == "-a")) {
		return Result{}, errors.New("COMMAND_NOT_ALLOWED")
	}
	if name == "pwd" {
		return Result{Stdout: e.Workspace + "\n"}, nil
	}
	dirs := []string{"/data/data/com.termux/files/usr/bin"}
	if runtime.GOOS != "android" {
		dirs = append(dirs, "/usr/bin", "/bin")
	}
	binary := ""
	for _, d := range dirs {
		candidate := filepath.Join(d, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			binary = candidate
			break
		}
	}
	if binary == "" {
		return Result{}, errors.New("COMMAND_NOT_INSTALLED")
	}
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(deadline, binary, argv...)
	cmd.Dir = e.Workspace
	cmd.Env = []string{"PATH=" + strings.Join(dirs, ":"), "LANG=C.UTF-8", "HOME=" + e.Workspace, "PREFIX=/data/data/com.termux/files/usr"}
	out := &limitBuffer{Limit: 24000}
	errout := &limitBuffer{Limit: 4000}
	cmd.Stdout = out
	cmd.Stderr = errout
	err := cmd.Run()
	r := Result{Stdout: out.String(), Stderr: errout.String()}
	if deadline.Err() != nil {
		return r, errors.New("TIMEOUT_OR_CANCELLED")
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			r.ExitCode = exit.ExitCode()
			return r, nil
		}
		return r, errors.New("EXECUTION_FAILED")
	}
	return r, nil
}
func (e Executor) files(tool string, args map[string]json.RawMessage) (Result, error) {
	p := text(args, "path")
	if err := SafePath(p); err != nil {
		return Result{}, err
	}
	root, err := os.OpenRoot(e.Workspace)
	if err != nil {
		return Result{}, err
	}
	defer root.Close()
	if tool == "files_list" {
		f, err := root.Open(p)
		if err != nil {
			return Result{}, errors.New("FILE_ACCESS_DENIED")
		}
		defer f.Close()
		entries, err := f.ReadDir(201)
		if err != nil && err != io.EOF {
			return Result{}, err
		}
		if len(entries) > 200 {
			return Result{}, errors.New("DIRECTORY_TOO_LARGE")
		}
		result := Result{Entries: []Entry{}}
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			result.Entries = append(result.Entries, Entry{Name: entry.Name(), Directory: entry.IsDir(), Size: info.Size()})
		}
		return result, nil
	}
	if tool == "files_read" {
		f, err := root.Open(p)
		if err != nil {
			return Result{}, errors.New("FILE_ACCESS_DENIED")
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return Result{}, errors.New("REGULAR_FILE_REQUIRED")
		}
		b, err := io.ReadAll(io.LimitReader(f, 32769))
		if err != nil {
			return Result{}, err
		}
		if len(b) > 32768 {
			return Result{}, errors.New("FILE_TOO_LARGE")
		}
		return Result{Content: string(b)}, nil
	}
	if !e.AllowWrite {
		return Result{}, errors.New("LOCAL_WRITE_PERMISSION_REQUIRED")
	}
	switch tool {
	case "files_write":
		content := text(args, "content")
		if len(content) > 32768 {
			return Result{}, errors.New("FILE_TOO_LARGE")
		}
		tmp := p + fmt.Sprintf(".byga-%d.tmp", time.Now().UnixNano())
		f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return Result{}, errors.New("FILE_ACCESS_DENIED")
		}
		defer root.Remove(tmp)
		_, err = f.WriteString(content)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return Result{}, err
		}
		if closeErr != nil {
			return Result{}, closeErr
		}
		if err = root.Rename(tmp, p); err != nil {
			return Result{}, err
		}
		return Result{OK: true}, nil
	case "files_delete":
		info, err := root.Lstat(p)
		if err != nil {
			return Result{}, err
		}
		if !info.Mode().IsRegular() {
			return Result{}, errors.New("REGULAR_FILE_REQUIRED")
		}
		if err = root.Remove(p); err != nil {
			return Result{}, err
		}
		return Result{OK: true}, nil
	}
	return Result{}, errors.New("DEVICE_CAPABILITY_UNAVAILABLE")
}
func (e Executor) bridge(ctx context.Context, tool string, args map[string]json.RawMessage) (Result, error) {
	if e.BridgeToken == "" {
		return Result{}, errors.New("BRIDGE_NOT_PAIRED")
	}
	if tool == "android_screenshot" {
		return Result{}, errors.New("DEVICE_CAPABILITY_UNAVAILABLE")
	}
	payload, _ := json.Marshal(map[string]any{"tool": tool, "arguments": args})
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", "http://127.0.0.1:17381/action", bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+e.BridgeToken)
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("REDIRECT_DENIED") }}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, errors.New("BRIDGE_OFFLINE")
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 40000))
	if err != nil {
		return Result{}, err
	}
	if resp.StatusCode != 200 {
		return Result{}, errors.New("ANDROID_LOCAL_APPROVAL_REQUIRED_OR_RESTRICTED")
	}
	var result Result
	if json.Unmarshal(b, &result) != nil {
		return Result{}, errors.New("INVALID_BRIDGE_RESULT")
	}
	return result, nil
}
