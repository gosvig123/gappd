package appprotocol

import "github.com/gappd-dev/gappd/internal/recording"

type CommandMode string

const (
	CommandModeRequest CommandMode = "request"
	CommandModeStream  CommandMode = "stream"
)

type CommandSpec struct {
	ID       string
	Mode     CommandMode
	Input    string
	Output   string
	Event    string
	ArgsExpr string
	Env      []string
	Terminal []recording.EventName
}

var Commands = []CommandSpec{
	{ID: "devices.list", Mode: CommandModeRequest, Input: "EmptyInput", Output: "DevicesResponse", ArgsExpr: "['app', 'devices', '--json']"},
	{ID: "meetings.list", Mode: CommandModeRequest, Input: "EmptyInput", Output: "MeetingsResponse", ArgsExpr: "['app', 'meetings', 'list', '--json']"},
	{ID: "meetings.show", Mode: CommandModeRequest, Input: "MeetingShowInput", Output: "MeetingResponse", ArgsExpr: "['app', 'meetings', 'show', input.id, '--json']"},
	{ID: "config.show", Mode: CommandModeRequest, Input: "EmptyInput", Output: "LocalAIConfigResponse", ArgsExpr: "['app', 'config', 'show', '--json']"},
	{ID: "config.useManagedOllama", Mode: CommandModeRequest, Input: "ConfigUseManagedOllamaInput", Output: "LocalAIConfigResponse", ArgsExpr: "['app', 'config', 'use-managed-ollama', '--endpoint', input.endpoint, '--model', input.model, ...(typeof input.temperature === 'number' ? ['--temperature', String(input.temperature)] : [])]"},
	{ID: "record.recoverStale", Mode: CommandModeRequest, Input: "RecoverStaleInput", Output: "RecoverStaleResponse", ArgsExpr: "['app', 'record', 'recover-stale', '--json', '--model', input.modelPath]", Env: []string{"GAPPD_WHISPER_BIN"}},
	{ID: "record.start", Mode: CommandModeStream, Input: "RecordStartInput", Event: "RecordingProtocolEvent", ArgsExpr: "['app', 'record', 'start', '--title', input.title, '--device', String(input.device), '--mode', input.mode, '--model', input.modelPath]", Env: []string{"GAPPD_CAPTURE_HELPER_PATH", "GAPPD_WHISPER_BIN"}, Terminal: []recording.EventName{recording.EventCompleted, recording.EventFailed}},
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
