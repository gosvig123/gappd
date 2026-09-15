package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gosvig123/gappd/cloud/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func localFixtureBytes(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(root, "gappd")
	command := exec.Command("go", "build", "-o", binary, "./cmd/gappd")
	command.Dir = "../../.."
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("fixture CLI build: %v %s", err, output)
	}
	profile := filepath.Join(root, "profile")
	if output, err := exec.Command(binary, "selected-fixture", "bootstrap", profile).CombinedOutput(); err != nil {
		t.Fatalf("bootstrap: %v %s", err, output)
	}
	return exportFixtureCLI(t, binary, profile)
}

func exportFixtureCLI(t *testing.T, binary, profile string) string {
	t.Helper()
	command := exec.Command(binary, "selected-fixture", "export", "72619a1d-f713-4f46-a2b8-c74e568726b1")
	command.Env = append(os.Environ(), "GAPPD_SELECTED_FIXTURE_PROFILE="+profile, "HOME="+filepath.Join(profile, "backend-home"))
	output, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	if string(output) != service.SelectedFixtureBytes {
		t.Fatal("local export differs from cloud allowlist")
	}
	return string(output)
}

func selectedRequest(t *testing.T, host, token, method, body string) (int, map[string]string) {
	t.Helper()
	request, _ := http.NewRequest(method, host+"/selected-demo-meeting", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	value := map[string]string{}
	if response.StatusCode == 200 {
		if err = json.NewDecoder(response.Body).Decode(&value); err != nil {
			t.Fatal(err)
		}
	}
	return response.StatusCode, value
}

func TestSelectedLocalSQLiteTransportMCPAndDeletion(t *testing.T) {
	reader, writer := demoDatabase(t)
	bytes := localFixtureBytes(t)
	a, sign := signerScopes(t, "meetings:sync", "desktop")
	host := httptest.NewServer(service.HandlerWithDemo(a, reader, writer, "desktop"))
	defer host.Close()
	owner := "selected-e2e-" + time.Now().Format("150405.000000000")
	code, ack := selectedRequest(t, host.URL, sign(owner), "POST", bytes)
	if code != 200 || ack["id"] != service.SelectedMeetingID(owner) {
		t.Fatalf("acceptance: %d", code)
	}
	assertSelectedRead(t, reader, owner, ack["id"])
	assertSelectedMCP(t, reader, owner, ack["id"])
	code, retry := selectedRequest(t, host.URL, sign(owner), "POST", bytes)
	if code != 200 || retry["expires_at"] != ack["expires_at"] {
		t.Fatal("retry changed expiry")
	}
	assertSelectedDeletion(t, host.URL, sign(owner), reader, writer, owner, bytes)
}

func assertSelectedDeletion(t *testing.T, host, token string, reader, writer *pgxpool.Pool, owner, bytes string) {
	t.Helper()
	code, _ := selectedRequest(t, host, token, "DELETE", "")
	if code != 200 {
		t.Fatal("delete failed")
	}
	assertSelectedGone(t, reader, writer, owner)
	code, _ = selectedRequest(t, host, token, "POST", bytes)
	if code == 200 {
		t.Fatal("deleted identity recreated")
	}
}

func assertSelectedMCP(t *testing.T, reader *pgxpool.Pool, owner, id string) {
	t.Helper()
	readAuth, readSign := signer(t)
	readHost := httptest.NewServer(service.Handler(readAuth, reader))
	defer readHost.Close()
	token := readSign(owner)
	session := connect(t, readHost.URL+"/mcp", &token)
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_meeting", Arguments: map[string]any{"id": id}})
	if err != nil || result.IsError {
		t.Fatal("MCP read failed", err)
	}
	assertSelectedMCPDocument(t, result, id)
}

func assertSelectedMCPDocument(t *testing.T, result *mcp.CallToolResult, id string) {
	t.Helper()
	data, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var got service.Meeting
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	want, err := service.ParseSelectedDocument([]byte(service.SelectedFixtureBytes))
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != id || !got.Synthetic || got.Title != want.Title || got.Summary != want.Summary ||
		got.Transcript != want.Transcript || got.StartedAt.UTC().Format(time.RFC3339) != want.StartedAt || got.UpdatedAt.IsZero() {
		t.Fatalf("MCP returned fields differ from uploaded document: %+v", got)
	}
}
