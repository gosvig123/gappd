package processgroup

import (
	"os/exec"
	"syscall"
)

func Configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func Signal(cmd *exec.Cmd, signal syscall.Signal) error {
	return syscall.Kill(-cmd.Process.Pid, signal)
}
