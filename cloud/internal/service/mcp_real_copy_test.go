package service_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gosvig123/gappd/cloud/internal/service"
)

// The whole loop: upload a real document, then read it back with the MCP tools.
func TestMCPReadsARealCopy(t *testing.T) {
	upload, reader, syncSign := uploadHost(t)
	owner := copyOwner("mcp-read")
	id := service.MeetingCopyID(owner, localMeeting)
	if code, _ := meetingRequest(t, upload.URL, syncSign(owner), "POST", meetingDoc(localMeeting, 2, "Real weekly sync")); code != 200 {
		t.Fatal("upload")
	}
	realReads(t, reader)
	// The read client is a separate client with its own read-only grant.
	readAuth, readSign := signerScopes(t, service.Scope, "pi")
	mcpHost := httptest.NewServer(service.Handler(readAuth, reader))
	t.Cleanup(mcpHost.Close)
	token := readSign(owner)
	session := connect(t, mcpHost.URL+"/mcp", &token)
	if text := toolText(t, session, "list_meetings", map[string]any{"limit": 5}); !strings.Contains(text, id) {
		t.Fatalf("list_meetings: %s", text)
	}
	if text := toolText(t, session, "get_meeting", map[string]any{"id": id}); !strings.Contains(text, "Real weekly sync") {
		t.Fatalf("get_meeting: %s", text)
	}
	if text := toolText(t, session, "search_meetings", map[string]any{"query": "Hello"}); !strings.Contains(text, id) {
		t.Fatalf("search_meetings: %s", text)
	}
	assertMCPHidesTheCopyFromAnotherAccount(t, mcpHost.URL, readSign, id)
}

func assertMCPHidesTheCopyFromAnotherAccount(t *testing.T, endpoint string, readSign func(string) string, id string) {
	t.Helper()
	otherToken := readSign(copyOwner("mcp-other"))
	other := connect(t, endpoint+"/mcp", &otherToken)
	if text := toolText(t, other, "list_meetings", map[string]any{"limit": 5}); strings.Contains(text, id) {
		t.Fatalf("cross-owner list_meetings: %s", text)
	}
	if result := callTool(t, other, "get_meeting", map[string]any{"id": id}); !result.IsError {
		t.Fatal("cross-owner get_meeting succeeded")
	}
}
