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
