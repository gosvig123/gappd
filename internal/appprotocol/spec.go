package appprotocol

import (
	"reflect"

	"github.com/gappd-dev/gappd/internal/meetingprocessing"
	"github.com/gappd-dev/gappd/internal/recording"
)

type CommandMode string

const (
	CommandModeRequest CommandMode = "request"
	CommandModeStream  CommandMode = "stream"
)

type EmptyInput struct{}

type MeetingShowInput struct {
	ID string `json:"id"`
}

type MeetingDeleteInput struct {
	ID string `json:"id"`
}

type ConfigUseManagedLocalAIInput struct {
	Endpoint    string   `json:"endpoint"`
	Model       string   `json:"model"`
	Temperature *float64 `json:"temperature,omitempty"`
}

type ProcessingDrainInput struct {
	Capability meetingprocessing.Capability `json:"capability"`
}

type RecordStartInput struct {
	Title    string `json:"title"`
	Device   int    `json:"device"`
	Mode     string `json:"mode"`
	Language string `json:"language"`
}

type CommandArg struct {
	Literal   string
	Field     string
	Flag      string
	Optional  bool
	Stringify bool
}

type CommandSpec struct {
	ID       string
	Mode     CommandMode
	Input    reflect.Type
	Output   reflect.Type
	Event    reflect.Type
	Args     []CommandArg
	Env      []string
	Terminal []recording.EventName
}

var Commands = []CommandSpec{
	{ID: "devices.list", Mode: CommandModeRequest, Input: typeOf[EmptyInput](), Output: typeOf[DevicesResponse](), Args: literalArgs("app", "devices", "--json")},
	{ID: "meetings.list", Mode: CommandModeRequest, Input: typeOf[EmptyInput](), Output: typeOf[MeetingsResponse](), Args: literalArgs("app", "meetings", "list", "--json")},
	{ID: "meetings.show", Mode: CommandModeRequest, Input: typeOf[MeetingShowInput](), Output: typeOf[MeetingResponse](), Args: []CommandArg{lit("app"), lit("meetings"), lit("show"), field("id"), lit("--json")}},
	{ID: "meetings.delete", Mode: CommandModeRequest, Input: typeOf[MeetingDeleteInput](), Output: typeOf[MeetingDeleteResponse](), Args: []CommandArg{lit("app"), lit("meetings"), lit("delete"), field("id"), lit("--json")}},
	{ID: "config.show", Mode: CommandModeRequest, Input: typeOf[EmptyInput](), Output: typeOf[ConfigResponse](), Args: literalArgs("app", "config", "show", "--json")},
	{ID: "config.useManagedLocalAI", Mode: CommandModeRequest, Input: typeOf[ConfigUseManagedLocalAIInput](), Output: typeOf[ConfigResponse](), Args: []CommandArg{lit("app"), lit("config"), lit("use-managed-local-ai"), flag("endpoint", "endpoint", false), flag("model", "model", false), flag("temperature", "temperature", true)}},
	{ID: "processing.drain", Mode: CommandModeRequest, Input: typeOf[ProcessingDrainInput](), Output: typeOf[ProcessingDrainResponse](), Args: []CommandArg{lit("app"), lit("processing"), lit("drain"), flag("capability", "capability", false), lit("--json")}},
	{ID: "record.hasStale", Mode: CommandModeRequest, Input: typeOf[EmptyInput](), Output: typeOf[HasStaleRecordingsResponse](), Args: literalArgs("app", "record", "has-stale", "--json")},
	{ID: "record.recoverStale", Mode: CommandModeRequest, Input: typeOf[EmptyInput](), Output: typeOf[RecoverStaleRecordingsResponse](), Args: literalArgs("app", "record", "recover-stale", "--json")},
	{ID: "record.start", Mode: CommandModeStream, Input: typeOf[RecordStartInput](), Event: typeOf[RecordingEvent](), Args: []CommandArg{lit("app"), lit("record"), lit("start"), flag("title", "title", false), flag("device", "device", false), flag("mode", "mode", false), flag("language", "language", false)}, Env: []string{"GAPPD_CAPTURE_HELPER_PATH"}, Terminal: []recording.EventName{recording.EventCaptured, recording.EventFailed}},
}

func RequestCommands() []CommandSpec {
	return commandsWithMode(CommandModeRequest)
}

func StreamCommands() []CommandSpec {
	return commandsWithMode(CommandModeStream)
}

func commandsWithMode(mode CommandMode) []CommandSpec {
	var out []CommandSpec
	for _, command := range Commands {
		if command.Mode == mode {
			out = append(out, command)
		}
	}
	return out
}

func typeOf[T any]() reflect.Type {
	return reflect.TypeOf((*T)(nil)).Elem()
}

func literalArgs(values ...string) []CommandArg {
	args := make([]CommandArg, len(values))
	for i, value := range values {
		args[i] = lit(value)
	}
	return args
}

func lit(value string) CommandArg {
	return CommandArg{Literal: value}
}

func field(name string) CommandArg {
	return CommandArg{Field: name}
}

func flag(name, field string, optional bool) CommandArg {
	return CommandArg{Flag: name, Field: field, Optional: optional, Stringify: true}
}
