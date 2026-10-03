# Phase F: Helm chart on kind

Tested 2026-10-03:
- kind v0.30.0, Kubernetes v1.34.0 (one node), Helm v3.19.0;
- images built from the repository's Dockerfile (tag 1.0.0) and loaded with `kind load`;
- chart `deploy/helm/aegis` with default values: 2 replicas per API server, Redis on.

## Results

| Check | Result |
|---|---|
| `helm lint`; `helm template` with HPA, ServiceMonitor and Ingress on | pass |
| `helm install --wait` | all 7 pods Running within seconds. Each `api-node` replica restarted once: the demo server exits when Redis is not reachable at start, and Redis was still starting |
| `helm test` (in-cluster, both servers): `/aegis/health` 200, `/aegis/ready` 200, `/aegis/metrics` contains `aegis_decisions_total`, telemetry returns an `AEGIS.v1` token | pass, after one fix (below) |
| Redis scaled to 0 | all 4 API pods became NotReady (readiness `/aegis/ready` returns 503) and left the Service endpoints. **No restarts**: liveness `/aegis/health` stayed green |
| Redis scaled back to 1 | all 4 Ready again without intervention |
| Token and session from replica A used on replica B (Python) | login 200 on both, same score: shared Secret and sessions in Redis |
| Dashboard nginx → `api-node` status API (`/aegis/stats`) | 200 |
| NetworkPolicy (dashboard → Redis / ML must be refused) | **not enforced in this environment**: see below |

**Fix found by `helm test`.** The Python image did not install
`prometheus_client`, so `/aegis/metrics` returned 501. The Dockerfile now
installs `aegis-server-python[redis,metrics]`.

**NetworkPolicy not verified.** The policies are accepted by the API server,
but kind's CNI (kindnet) could not program nftables in this sandbox ("netlink
receive: no such file or directory"), so nothing enforced them. ipset is not
available either, so an iptables-based policy controller is not an option
here. Enforcement depends on the cluster's CNI (Calico, Cilium, kindnet on a
normal kernel) and is untested.

## Environment notes (not chart problems)

The test ran inside a sandboxed container: a Firecracker VM, cgroup v1, Docker
in the VM. Two workarounds were needed to get kind to start (deploy/README.md):

1. **No negative `oom_score_adj`.**
   - runc could not set -998 on pause containers ("can't get final child's PID from pipe: EOF").
   - Found by bisecting an OCI spec by hand with runc.
   - Fix: containerd `restrict_oom_score_adj = true` (kind `containerdConfigPatches`).
2. **The kubelet did not start.**
   - The host has no `hugetlb` cgroup mount, so kind's entrypoint did not create `hugetlb/kubelet.slice`.
   - Fix: create it in the node container, then run `kubeadm init --config /kind/kubeadm.conf` and apply kind's CNI and storage manifests by hand.

Also, image pulls inside the cluster fail behind the TLS-intercepting proxy, so
every image (including `redis:7-alpine`) was loaded from the host.

k3s in Docker was tried first as an alternative and failed on the same runc
error.
