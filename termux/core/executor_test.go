package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func args(v map[string]any) map[string]json.RawMessage {
	b, _ := json.Marshal(v)
	var a map[string]json.RawMessage
	_ = json.Unmarshal(b, &a)
	return a
}
func TestDenyShellAndArguments(t *testing.T) {
	e := Executor{Workspace: t.TempDir()}
	for _, a := range []map[string]any{{"command": "sh", "args": []string{"-c", "id"}}, {"command": "date", "args": []string{";touch", "pwn"}}, {"command": "uname", "args": []string{"-a", ";id"}}} {
		if _, err := e.Run(context.Background(), "terminal_run", args(a)); err == nil {
			t.Fatal("dangerous command permitted")
		}
	}
}
func TestFilesSandbox(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	_ = os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600)
	_ = os.Symlink(outside, filepath.Join(root, "escape"))
	e := Executor{Workspace: root, AllowWrite: true}
	for _, p := range []string{"../secret", "/etc/passwd", "escape/secret"} {
		if _, err := e.Run(context.Background(), "files_read", args(map[string]any{"path": p})); err == nil {
			t.Fatalf("escaped sandbox %s", p)
		}
	}
	if _, err := e.Run(context.Background(), "files_write", args(map[string]any{"path": "escape/stolen", "content": "x"})); err == nil {
		t.Fatal("symlink write escaped")
	}
}
func TestWriteReadAndLocalDeny(t *testing.T) {
	e := Executor{Workspace: t.TempDir()}
	a := args(map[string]any{"path": "a.txt", "content": "hello"})
	if _, err := e.Run(context.Background(), "files_write", a); err == nil {
		t.Fatal("write without local permission")
	}
	e.AllowWrite = true
	if _, err := e.Run(context.Background(), "files_write", a); err != nil {
		t.Fatal(err)
	}
	r, err := e.Run(context.Background(), "files_read", a)
	if err != nil || r.Content != "hello" {
		t.Fatal(r, err)
	}
}
func TestOutputBound(t *testing.T) {
	b := &limitBuffer{Limit: 5}
	n, err := b.Write([]byte("123456789"))
	if n != 9 || err != nil || b.String() != "12345" {
		t.Fatal(n, err, b.String())
	}
}
