package appprotocol

import "github.com/gappd-dev/gappd/internal/db"

type Person struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

func BuildPeople(people []db.Person) []Person {
	result := make([]Person, 0, len(people))
	for _, person := range people {
		result = append(result, Person{ID: person.ID, Name: person.Name, Email: person.Email})
	}
	return result
}

type PeopleResponse struct {
	People []Person `json:"people"`
}

type PersonActionItemsInput struct {
	ID string `json:"id"`
}

type PersonActionItem struct {
	MeetingID    string `json:"meetingId"`
	MeetingTitle string `json:"meetingTitle"`
	StartedAt    string `json:"startedAt"`
	Task         string `json:"task"`
	Deadline     string `json:"deadline,omitempty"`
}

type PersonActionItemsResponse struct {
	Items []PersonActionItem `json:"items"`
}

func BuildPersonActionItems(items []db.PersonActionItem) []PersonActionItem {
	result := make([]PersonActionItem, 0, len(items))
	for _, item := range items {
		result = append(result, PersonActionItem(item))
	}
	return result
}

type PersonFactsInput struct {
	ID string `json:"id"`
}

// PersonFact is one fact about a Person. Person is the name of that Person, never a speaker
// label, and every quote is theirs.
type PersonFact struct {
	ID           int64    `json:"id"`
	Person       string   `json:"person"`
	MeetingID    string   `json:"meetingId"`
	MeetingTitle string   `json:"meetingTitle"`
	StartedAt    string   `json:"startedAt"`
	Kind         string   `json:"kind"`
	Text         string   `json:"text"`
	Quotes       []string `json:"quotes"`
	Hidden       bool     `json:"hidden"`
}

type PersonFactsResponse struct {
	Facts []PersonFact `json:"facts"`
}

func BuildPersonFacts(person string, facts []db.PersonFact) []PersonFact {
	result := make([]PersonFact, 0, len(facts))
	for _, fact := range facts {
		result = append(result, PersonFact{ID: fact.ID, Person: person, MeetingID: fact.MeetingID, MeetingTitle: fact.MeetingTitle,
			StartedAt: fact.StartedAt, Kind: fact.Kind, Text: fact.Text, Quotes: append([]string{}, fact.Quotes...), Hidden: fact.Hidden})
	}
	return result
}

// HidePersonFactInput hides one fact of a Person, or shows it again when Hidden is false.
type HidePersonFactInput struct {
	ID     string `json:"id"`
	Fact   int64  `json:"fact"`
	Hidden bool   `json:"hidden"`
}

// ExtractPersonFactsInput reads one Meeting when Meeting is set, else every Meeting that needs it.
// Count only counts the Meetings that need it, without the notes provider.
type ExtractPersonFactsInput struct {
	Meeting string `json:"meeting,omitempty"`
	Count   bool   `json:"count,omitempty"`
}

type ExtractPersonFactsResponse struct {
	Pending   int `json:"pending"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

type UpdatePersonInput struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

// ImportPeopleInput carries contacts as a JSON array of {name, email}, because command
// arguments are strings.
type ImportPeopleInput struct {
	Contacts string `json:"contacts"`
}

type ImportPeopleResponse struct {
	People  []Person `json:"people"`
	Added   int      `json:"added"`
	Updated int      `json:"updated"`
}

type MergePeopleInput struct {
	KeepID  string `json:"keepId"`
	MergeID string `json:"mergeId"`
	Name    string `json:"name"`
	Email   string `json:"email,omitempty"`
}

type AssignSpeakerInput struct {
	ID         string `json:"id"`
	SpeakerKey string `json:"speakerKey"`
	PersonID   string `json:"personId,omitempty"`
	Name       string `json:"name,omitempty"`
	Email      string `json:"email,omitempty"`
}

type SpeakerClipInput struct {
	ID         string `json:"id"`
	SpeakerKey string `json:"speakerKey"`
	Index      int    `json:"index,omitempty"`
}

type SpeakerClipResponse struct {
	Text        string  `json:"text"`
	StartSec    float64 `json:"startSec"`
	AudioBase64 string  `json:"audioBase64"`
	MimeType    string  `json:"mimeType"`
}

type RecognizeSpeakersInput struct {
	ID       string `json:"id"`
	Revision int    `json:"revision"`
	Emails   string `json:"emails"`
	Calendar bool   `json:"calendar"`
}

type MeetingSpeaker struct {
	IdentityOrigin    string  `json:"identityOrigin,omitempty"`
	Key               string  `json:"key"`
	Name              string  `json:"name"`
	PersonID          *string `json:"personId,omitempty"`
	SuggestedPersonID *string `json:"suggestedPersonId,omitempty"`
}

// WithSpeakerSuggestions adds voice suggestions to unlabeled speakers.
func WithSpeakerSuggestions(detail MeetingDetail, suggestions map[string]string) MeetingDetail {
	for i, speaker := range detail.Speakers {
		if person, ok := suggestions[speaker.Key]; ok && speaker.PersonID == nil {
			detail.Speakers[i].SuggestedPersonID = &person
		}
	}
	return detail
}

func buildSpeakerViews(segments []db.Segment) []MeetingSpeaker {
	speakers := make([]MeetingSpeaker, 0)
	seen := make(map[string]bool)
	for _, segment := range segments {
		key := segment.RawSpeaker()
		if key == "" || key == db.SpeakerOther || seen[key] {
			continue
		}
		seen[key] = true
		speakers = append(speakers, MeetingSpeaker{Key: key, Name: segment.Speaker, PersonID: segment.PersonID, IdentityOrigin: segment.IdentityOrigin})
	}
	return speakers
}

type VoiceTargetsInput struct {
	After string `json:"after"`
}
type VoiceTargetsResponse struct {
	Targets []VoiceTarget `json:"targets"`
}

type VoiceTarget db.VoiceTarget

func BuildVoiceTargets(targets []db.VoiceTarget) []VoiceTarget {
	out := make([]VoiceTarget, len(targets))
	for i, target := range targets {
		out[i] = VoiceTarget(target)
	}
	return out
}
