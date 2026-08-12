const DESIGNATED_PREFIX = 'designated => '

function designatedRequirement(output) {
  const line = output.split('\n').find((candidate) => candidate.includes(DESIGNATED_PREFIX))
  if (!line) throw new Error('codesign output did not contain a designated requirement')
  return line.slice(line.indexOf(DESIGNATED_PREFIX) + DESIGNATED_PREFIX.length).trim()
}

function needsScreenReset(previous, incoming) {
  return Boolean(previous && previous !== incoming)
}

module.exports = { designatedRequirement, needsScreenReset }
