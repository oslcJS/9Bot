const fs = require('fs')
const path = require('path')

const runsPath = path.join(__dirname, 'data', 'runs.json')

function logRun(run) {
  fs.mkdirSync(path.dirname(runsPath), { recursive: true })
  fs.appendFileSync(runsPath, JSON.stringify(run) + '\n')
}

module.exports = { logRun }
