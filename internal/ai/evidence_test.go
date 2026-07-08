package ai

import "testing"

func TestRequireSupportedEvidenceDropsUnsupportedClaims(t *testing.T) {
	extraction := &Extraction{
		Topics:      []Topic{{Name: "Agency", Summary: "Agency was cancelled", Evidence: []EvidenceQuote{{Speaker: "Other", Text: "Do not pursue agency with Cabo"}}}},
		Decisions:   []Decision{{What: "Do not pursue agency with Cabo", Status: "rejected", Evidence: []EvidenceQuote{{Speaker: "Other", Text: "Do not pursue agency with Cabo"}}}},
		ActionItems: []ExtractedAction{{Task: "Research competitors", Evidence: []EvidenceQuote{{Speaker: "Other", Text: "Research competitors this week"}}}},
	}
	transcript := "[Other] I disagree with his approach because he wants to use himself as the first client."

	got := requireSupportedEvidence(extraction, transcript)
	if len(got.Topics) != 0 || len(got.Decisions) != 0 || len(got.ActionItems) != 0 {
		t.Fatalf("extraction = %#v, want unsupported claims dropped", got)
	}
}

func TestRequireSupportedEvidenceKeepsExactEvidence(t *testing.T) {
	extraction := &Extraction{Decisions: []Decision{{What: "Reject first-client validation", Status: "rejected", Evidence: []EvidenceQuote{{Speaker: "Other", Text: "he wants to study the agency and use him as the first client"}}}}}
	transcript := "[Other] he wants to study the agency and use him as the first client"

	got := requireSupportedEvidence(extraction, transcript)
	if len(got.Decisions) != 1 {
		t.Fatalf("decisions = %#v, want supported decision", got.Decisions)
	}
}
