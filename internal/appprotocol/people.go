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
	IdentityOrigin string  `json:"identityOrigin,omitempty"`
	Key            string  `json:"key"`
	Name           string  `json:"name"`
	PersonID       *string `json:"personId,omitempty"`
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
