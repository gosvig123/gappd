package ai

import (
	"context"
	"sort"
	"strings"
	"sync"
)

const agendaConcurrency = 4
const agendaMergeSystem = agendaSystem + ` Select at most eight useful topics from these retained candidates, supplied in original evidence order. This is intentional prioritization, not exhaustive extraction. Do not invent new quotes. Return retainedIndex identifying a supplied candidate and copy its sourceId and quote exactly. Set quoteOccurrence:0; original occurrence provenance is retained by the host. Topics must be at most 240 UTF-8 bytes. Return items only.`

var agendaMergeSchema = strings.Replace(agendaRollingSchema, `"maximum":7`, `"maximum":15`, 1)

func agendaHistoryCalls(sections int) int {
	return 2*sections + max(0, min(agendaConcurrency, sections)-1)
}

// Four contiguous chronological partitions cover every section. Pairwise merges
// retain exact candidate identity without putting all four states in one prompt.
func selectAgendaPartitions(ctx context.Context, provider Provider, title string, sources []AgendaSource, sections []agendaSection) ([]agendaCandidate, error) {
	count := min(agendaConcurrency, len(sections))
	states := make([][]agendaCandidate, count)
	err := parallelAgenda(ctx, count, func(ctx context.Context, i int) error {
		var err error
		states[i], err = rollAgendaPartition(ctx, provider, title, sections[i*len(sections)/count:(i+1)*len(sections)/count])
		return err
	})
	if err != nil {
		return nil, err
	}
	return mergeAgendaPartitions(ctx, provider, title, sources, states)
}

func rollAgendaPartition(ctx context.Context, provider Provider, title string, sections []agendaSection) ([]agendaCandidate, error) {
	items := []agendaCandidate{}
	for _, section := range sections {
		var err error
		items, err = rollAgendaSection(ctx, provider, title, section, items)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func mergeAgendaPartitions(ctx context.Context, provider Provider, title string, sources []AgendaSource, states [][]agendaCandidate) ([]agendaCandidate, error) {
	if len(states) == 0 {
		return []agendaCandidate{}, nil
	}
	for len(states) > 1 {
		next := make([][]agendaCandidate, (len(states)+1)/2)
		err := parallelAgenda(ctx, len(next), func(ctx context.Context, i int) error {
			next[i] = states[2*i]
			if 2*i+1 == len(states) {
				return nil
			}
			items := append(append([]agendaCandidate{}, states[2*i]...), states[2*i+1]...)
			var err error
			next[i], err = mergeAgendaCandidates(ctx, provider, title, sources, items)
			return err
		})
		if err != nil {
			return nil, err
		}
		states = next
	}
	return states[0], nil
}

func mergeAgendaCandidates(ctx context.Context, provider Provider, title string, sources []AgendaSource, items []agendaCandidate) ([]agendaCandidate, error) {
	sort.SliceStable(items, func(i, j int) bool {
		left, right := agendaSourceIndex(sources, items[i].SourceID), agendaSourceIndex(sources, items[j].SourceID)
		if left == right {
			return items[i].QuoteStart < items[j].QuoteStart
		}
		return left < right
	})
	section := agendaSection{}
	raw, err := agendaComplete(ctx, provider, agendaMergeSystem, agendaMergeSchema, rollingAgendaInput(title, section, items))
	if err != nil {
		return nil, err
	}
	return validateRollingAgenda(raw, section, items)
}

// All requests, including merges, are preflighted before starting any provider.
func preflightAgendaMerge(title string) error {
	input := rollingAgendaInput(title, agendaSection{}, nil)
	if len(input)+2*agendaStateBytes+len(agendaMergeSystem)+len(agendaMergeSchema) > agendaRequestBytes {
		return agendaLimit()
	}
	return nil
}

func parallelAgenda(ctx context.Context, count int, work func(context.Context, int) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan int, count)
	for i := 0; i < count; i++ {
		jobs <- i
	}
	close(jobs)
	var group sync.WaitGroup
	var once sync.Once
	var failure error
	for worker := 0; worker < min(agendaConcurrency, count); worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			runAgendaJobs(ctx, jobs, work, func(err error) { once.Do(func() { failure = err; cancel() }) })
		}()
	}
	group.Wait()
	if failure != nil {
		return failure
	}
	return ctx.Err()
}

func runAgendaJobs(ctx context.Context, jobs <-chan int, work func(context.Context, int) error, fail func(error)) {
	for i := range jobs {
		if ctx.Err() != nil {
			return
		}
		if err := work(ctx, i); err != nil {
			fail(err)
			return
		}
	}
}
