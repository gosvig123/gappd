package appprotocol

// LiveActionDraft is separate from final meeting extraction and summary.
type LiveActionDraft struct {
	SnapshotID       string           `json:"snapshotId"`
	SnapshotAt       string           `json:"snapshotAt"`
	SegmentCount     int              `json:"segmentCount"`
	LatestSegmentEnd float64          `json:"latestSegmentEnd"`
	Actions          []LiveActionItem `json:"actions"`
}

type LiveActionItem struct {
	Task     string `json:"task"`
	Owner    string `json:"owner,omitempty"`
	Deadline string `json:"deadline,omitempty"`
}

type LiveActionsResponse struct {
	Draft *LiveActionDraft `json:"draft,omitempty"`
}
