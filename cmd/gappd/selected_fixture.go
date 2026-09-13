package main

import (
	"os"

	"github.com/gappd-dev/gappd/internal/selectedfixture"
	"github.com/spf13/cobra"
)

func selectedFixtureCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "selected-fixture", Short: "Explicit isolated synthetic development fixture"}
	cmd.AddCommand(&cobra.Command{Use: "bootstrap [new-absolute-profile]", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, args []string) error {
		return selectedfixture.Bootstrap(args[0])
	}})
	cmd.AddCommand(&cobra.Command{Use: "export [local-id]", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, args []string) error {
		data, err := selectedfixture.Export(os.Getenv("GAPPD_SELECTED_FIXTURE_PROFILE"), args[0])
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(data)
		return err
	}})
	return cmd
}
