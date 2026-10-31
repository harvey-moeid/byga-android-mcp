package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHTTPSRequired(t *testing.T) {
	for _, s := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=secret"} {
		if validateServer(s, false) == nil {
			t.Fatal("accepted", s)
		}
	}
	if validateServer("https://example.com", false) != nil {
		t.Fatal("valid HTTPS rejected")
	}
	if validateServer("http://127.0.0.1:8788", true) != nil {
		t.Fatal("local simulator rejected")
	}
	if validateServer("http://127.0.0.1:8788", false) == nil {
		t.Fatal("plaintext without local opt-in")
	}
}
func TestJournalPersistsAndRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	j := journal{dir: dir}
	id := "12345678-1234-1234-1234-123456789012"
	m := Message{Type: "result", JobID: id, Error: "EXECUTION_STATUS_UNKNOWN"}
	if err := j.write(m); err != nil {
		t.Fatal(err)
	}
	next := journal{dir: dir}
	r, exists := next.read(id)
	if !exists || r.Error != m.Error {
		t.Fatal(r, exists)
	}
	if err := j.write(Message{Type: "tombstone", JobID: id}); err != nil {
		t.Fatal(err)
	}
	if r, _ := next.read(id); r.Type != "tombstone" {
		t.Fatal(r)
	}
	if j.path("../../escape") != "" {
		t.Fatal("journal traversal allowed")
	}
	info, err := os.Stat(filepath.Join(dir, id+".json"))
	if err != nil || info.Mode().Perm()&0077 != 0 {
		t.Fatal("credential journal permissions", err)
	}
}
