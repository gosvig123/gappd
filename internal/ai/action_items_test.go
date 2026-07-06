package ai

import "testing"

func TestNormalizeActionItemsMarkdownRemovesTranscriptSpeakerBuckets(t *testing.T) {
	input := "## Meeting Title\nDemo\n### Action Items\n#### You\n- [ ] Draft launch plan (@You, due: Friday)\n### Other\n- [ ] Other: Share notes (@Other, due: unspecified)\n- [ ] Confirm rollout (due by unknown)\n### Open Questions\n- Who owns onboarding?"
	want := "## Meeting Title\nDemo\n### Action Items\n- [ ] Draft launch plan (due: Friday)\n- [ ] Share notes\n- [ ] Confirm rollout\n### Open Questions\n- Who owns onboarding?"

	got := normalizeActionItemsMarkdown(input)
	if got != want {
		t.Fatalf("normalized markdown = %q, want %q", got, want)
	}
}

func TestNormalizeActionItemsMarkdownLeavesOtherSections(t *testing.T) {
	input := "### Key Topics\n#### Other\n- You: reviewed options\n### Action Items\n- [ ] Follow up"

	got := normalizeActionItemsMarkdown(input)
	if got != input {
		t.Fatalf("normalized markdown = %q, want unchanged input", got)
	}
}

func TestNormalizeNotesMarkdownClearsEmptyExtractionSections(t *testing.T) {
	input := "### Summary\nWe discussed merge approval.\n### Decisions\n- Approve PR\n### Action Items\n- Follow up\n### Open Questions\n- Who owns it?"
	want := "### Summary\nWe discussed merge approval.\n### Decisions\nNone identified\n### Action Items\nNone identified\n### Open Questions\nNone identified"

	got := normalizeNotesMarkdown(input, &Extraction{})
	if got != want {
		t.Fatalf("normalized markdown = %q, want %q", got, want)
	}
}

func TestNormalizeNotesMarkdownKeepsNonEmptyDecisionSection(t *testing.T) {
	input := "### Summary\nWe decided scope.\n### Decisions\n- Ship beta\n### Action Items\nNone identified"
	extraction := &Extraction{Decisions: []Decision{{What: "Ship beta"}}}

	got := normalizeNotesMarkdown(input, extraction)
	if got != input {
		t.Fatalf("normalized markdown = %q, want unchanged input", got)
	}
}
