import { defineRailway, github, postgres, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const gappd = github("gosvig123/gappd", { rootDirectory: "/cloud" });

  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 50000 });
  const gappdCloudCleanup = service("gappd-cloud-cleanup", {
    source: gappd,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/cloud/**"] },
    start: "/cleanup",
    // A cron job that exits after one run serves no HTTP, so it has no healthcheck.
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { cronSchedule: "0 * * * *", restartPolicyType: "NEVER" },
  });
  const gappdCloudApi = service("gappd-cloud-api", {
    source: gappd,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/cloud/**"] },
    healthcheck: "/ready",
    healthcheckTimeout: 60,
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyMaxRetries: 3 },
  });

  return project("gappd-cloud", {
    variables: { managed: false },
    resources: [gappdCloudCleanup, Postgres, gappdCloudApi, postgresVolume],
  });
});
