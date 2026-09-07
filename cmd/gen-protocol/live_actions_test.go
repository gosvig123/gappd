package main

import (
	"strings"
	"testing"
)

func TestLiveActionContractsStaySeparate(t *testing.T) {
	core := renderContracts()
	draft := renderLiveActionContracts()
	for _, name := range []string{"LiveActionDraft", "LiveActionItem", "LiveActionsResponse"} {
		if strings.Contains(core, "export type "+name) {
			t.Fatalf("%s leaked into core contracts", name)
		}
		if !strings.Contains(draft, "export type "+name) {
			t.Fatalf("%s missing from draft contracts", name)
		}
	}
	if strings.Count(core, "\n") > 200 || strings.Count(draft, "\n") > 200 {
		t.Fatal("generated contract module exceeds 200 lines")
	}
	if !strings.Contains(renderAppProtocol(), "from './live-actions'") {
		t.Fatal("app protocol missing draft contract import")
	}
}

func TestMeetingContractsCarryDraftWithoutDedicatedReadCommand(t *testing.T) {
	if !strings.Contains(renderContracts(), "liveActionDraft?: LiveActionDraft") {
		t.Fatal("Meeting reads must include the persisted draft")
	}
	protocol := renderAppProtocol()
	if strings.Contains(protocol, "'meetings.liveActions'") {
		t.Fatal("obsolete draft read command remains")
	}
	if !strings.Contains(protocol, "'meetings.generateLiveActions'") {
		t.Fatal("draft generation command missing")
	}
}
