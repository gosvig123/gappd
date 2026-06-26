package transcribe

type activeCluster struct {
	first    int
	last     int
	activeMS int
}

func activeClusters(windows []int, threshold int) []activeCluster {
	clusters := []activeCluster{}
	current := activeCluster{first: -1}
	for i, rms := range windows {
		if rms < threshold {
			continue
		}
		if shouldStartNewCluster(current, i) {
			clusters = appendCluster(clusters, current)
			current = activeCluster{first: i}
		}
		current = addActiveWindow(current, i)
	}
	return appendCluster(clusters, current)
}

func shouldStartNewCluster(cluster activeCluster, index int) bool {
	return cluster.first != -1 && clusterGapMS(cluster.last, index) > activeClusterGapMS
}

func addActiveWindow(cluster activeCluster, index int) activeCluster {
	if cluster.first == -1 {
		cluster.first = index
	}
	cluster.last = index
	cluster.activeMS += activeWindowMS
	return cluster
}

func appendCluster(clusters []activeCluster, cluster activeCluster) []activeCluster {
	if cluster.first != -1 && cluster.activeMS >= activeClusterMinMS {
		return append(clusters, cluster)
	}
	return clusters
}

func clusterGapMS(previous, next int) int {
	return (next - previous - 1) * activeWindowMS
}

func activeDuration(clusters []activeCluster) int {
	total := 0
	for _, cluster := range clusters {
		total += cluster.activeMS
	}
	return total
}
