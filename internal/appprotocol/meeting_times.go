package appprotocol

type MeetingTime struct {
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
}

type MeetingTimesResponse struct {
	Meetings []MeetingTime `json:"meetings"`
}
