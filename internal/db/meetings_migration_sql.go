package db

// Legacy status columns are migration input only. Current runtime never adds or
// writes them; delete them during a future table rebuild after this migration has run.
const artifactStatusExpr = `CASE
	WHEN summary IS NOT NULL AND summary <> '' THEN 'completed'
	WHEN transcript IS NOT NULL AND transcript <> '' THEN 'failed'
	WHEN ended_at IS NOT NULL AND ended_at <> '' THEN 'failed'
	ELSE 'recording'
END`

const artifactUpdatedAtExpr = `CASE
	WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
	ELSE started_at
END`

const captureStatusBackfillSQL = `UPDATE meetings SET capture_status = CASE
	WHEN %s = 'failed' AND (ended_at IS NULL OR ended_at = '') AND (transcript IS NULL OR transcript = '') THEN 'failed'
	WHEN %s IN ('processing', 'completed') THEN 'captured'
	WHEN %s = 'failed' AND (
		(audio_path IS NOT NULL AND audio_path <> '') OR
		(transcript IS NOT NULL AND transcript <> '') OR
		(summary IS NOT NULL AND summary <> '')
	) THEN 'captured'
	WHEN %s = 'failed' THEN 'failed'
	ELSE 'recording'
END`

const captureUpdatedAtBackfillSQL = `UPDATE meetings SET capture_status_updated_at = CASE
	WHEN capture_status = 'recording' THEN started_at
	WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
	WHEN %s IS NOT NULL AND %s <> '' THEN %s
	ELSE started_at
END`

const captureFailureBackfillSQL = `UPDATE meetings SET capture_failure_message = CASE
	WHEN %s = 'failed' AND (ended_at IS NULL OR ended_at = '') AND (transcript IS NULL OR transcript = '') THEN %s
	ELSE capture_failure_message
END`

const processingStatusBackfillSQL = `UPDATE meetings SET processing_status = CASE
	WHEN %s = 'processing' THEN 'processing'
	WHEN %s = 'completed' THEN 'completed'
	WHEN %s = 'failed' AND (ended_at IS NOT NULL AND ended_at <> '') THEN 'failed'
	ELSE 'not_started'
END`

const processingUpdatedAtBackfillSQL = `UPDATE meetings SET processing_status_updated_at = CASE
	WHEN processing_status = 'not_started' THEN started_at
	WHEN %s IS NOT NULL AND %s <> '' THEN %s
	WHEN ended_at IS NOT NULL AND ended_at <> '' THEN ended_at
	ELSE started_at
END`

const processingFailureBackfillSQL = `UPDATE meetings SET processing_failure_message = CASE
	WHEN %s = 'failed' AND (ended_at IS NOT NULL AND ended_at <> '') THEN %s
	ELSE processing_failure_message
END`
