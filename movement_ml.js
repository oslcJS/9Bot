const fs = require('fs')
const path = require('path')

class Layer {
  constructor(inputSize, outputSize, activation = 'tanh') {
    this.inputSize = inputSize
    this.outputSize = outputSize
    this.activation = activation
    this.weights = []
    this.biases = []

    const scale = Math.sqrt(2 / inputSize)
    for (let o = 0; o < outputSize; o++) {
      this.weights[o] = []
      for (let i = 0; i < inputSize; i++) {
        this.weights[o][i] = (Math.random() * 2 - 1) * scale
      }
      this.biases[o] = (Math.random() * 2 - 1) * 0.1
    }
  }

  forward(inputs) {
    this.lastInput = inputs
    this.lastOutput = []
    for (let o = 0; o < this.outputSize; o++) {
      let sum = this.biases[o]
      for (let i = 0; i < this.inputSize; i++) {
        sum += this.weights[o][i] * inputs[i]
      }
      const act = this.activation
      if (act === 'tanh') this.lastOutput[o] = Math.tanh(sum)
      else if (act === 'sigmoid') this.lastOutput[o] = 1 / (1 + Math.exp(-sum))
      else if (act === 'relu') this.lastOutput[o] = Math.max(0, sum)
      else this.lastOutput[o] = sum
    }
    return this.lastOutput
  }

  copy() {
    const layer = new Layer(this.inputSize, this.outputSize, this.activation)
    for (let o = 0; o < this.outputSize; o++) {
      for (let i = 0; i < this.inputSize; i++) {
        layer.weights[o][i] = this.weights[o][i]
      }
      layer.biases[o] = this.biases[o]
    }
    return layer
  }

  mutate(rate) {
    for (let o = 0; o < this.outputSize; o++) {
      for (let i = 0; i < this.inputSize; i++) {
        if (Math.random() < rate) {
          this.weights[o][i] += (Math.random() * 2 - 1) * 0.5
        }
      }
      if (Math.random() < rate) {
        this.biases[o] += (Math.random() * 2 - 1) * 0.3
      }
    }
  }

  toJSON() {
    return {
      inputSize: this.inputSize, outputSize: this.outputSize,
      activation: this.activation, weights: this.weights, biases: this.biases
    }
  }

  static fromJSON(data) {
    const layer = new Layer(data.inputSize, data.outputSize, data.activation)
    layer.weights = data.weights
    layer.biases = data.biases
    return layer
  }
}

class NeuralNetwork {
  constructor(layerSizes, activations = null) {
    this.layers = []
    for (let i = 0; i < layerSizes.length - 1; i++) {
      const act = activations ? activations[i] : (i < layerSizes.length - 2 ? 'tanh' : 'sigmoid')
      this.layers.push(new Layer(layerSizes[i], layerSizes[i + 1], act))
    }
  }

  forward(inputs) {
    let current = inputs
    for (const layer of this.layers) current = layer.forward(current)
    return current
  }

  copy() {
    const nn = new NeuralNetwork([1, 1])
    nn.layers = this.layers.map(l => l.copy())
    return nn
  }

  mutate(rate) {
    for (const layer of this.layers) layer.mutate(rate)
  }

  save(filepath) {
    fs.writeFileSync(filepath, JSON.stringify(this.layers.map(l => l.toJSON()), null, 2))
  }

  static load(filepath) {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    const nn = new NeuralNetwork([1, 1])
    nn.layers = data.map(d => Layer.fromJSON(d))
    return nn
  }

  countParams() {
    let total = 0
    for (const layer of this.layers) {
      total += layer.weights.length * layer.weights[0].length + layer.biases.length
    }
    return total
  }
}

const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,1,1,0,0,1,1,1,0,0,0,0,0,1],
  [1,0,0,1,0,0,0,1,0,0,0,0,1,1,0,1],
  [1,0,0,0,0,0,0,1,0,0,1,0,1,0,0,1],
  [1,0,1,0,0,1,0,0,0,0,1,0,1,0,0,1],
  [1,0,1,0,0,1,0,0,0,0,1,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,1,0,0,1,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1],
  [1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,1,1,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
]

const CELL = 2
const MAX_STEPS = 300
const REACH_DIST = 2.0
const START = { x: 2, z: 2 }
const TARGET = { x: 14, z: 14 }

function blocked(x, z) {
  const col = Math.floor(x / CELL)
  const row = Math.floor(z / CELL)
  if (col < 0 || col >= MAP[0].length || row < 0 || row >= MAP.length) return true
  return MAP[row][col] === 1
}

class MovementSimulation {
  constructor() {
    this.reset()
  }

  reset() {
    this.pos = { x: START.x, z: START.z }
    this.prevDist = this.distanceTo()
    this.stepCount = 0
    this.totalReward = 0
    this.trail = [{ ...this.pos }]
    this.done = false
    this.stuckSteps = 0
    this.lastPos = { ...this.pos }
    this.maxProgress = 0
  }

  distanceTo(px, pz) {
    const x = px != null ? px : this.pos.x
    const z = pz != null ? pz : this.pos.z
    return Math.sqrt(Math.pow(TARGET.x - x, 2) + Math.pow(TARGET.z - z, 2))
  }

  getState() {
    const dx = TARGET.x - this.pos.x
    const dz = TARGET.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const maxDist = 20
    const sense = 2.5

    const f = blocked(this.pos.x, this.pos.z + sense)
    const b = blocked(this.pos.x, this.pos.z - sense)
    const l = blocked(this.pos.x - sense, this.pos.z)
    const r = blocked(this.pos.x + sense, this.pos.z)
    const fl = blocked(this.pos.x - sense, this.pos.z + sense)
    const fr = blocked(this.pos.x + sense, this.pos.z + sense)

    return [
      dx / maxDist,
      dz / maxDist,
      dist / maxDist,
      f ? 1 : 0,
      b ? 1 : 0,
      l ? 1 : 0,
      r ? 1 : 0,
      fl ? 1 : 0,
      fr ? 1 : 0,
      this.stepCount / MAX_STEPS
    ]
  }

  step(action) {
    if (this.done) return { state: this.getState(), reward: 0, done: true }
    this.stepCount++

    const moveX = Math.tanh(action[0] || 0) * 0.5
    const moveZ = Math.tanh(action[1] || 0) * 0.5
    const jump = (action[2] || 0) > 0.5
    const speed = jump ? 0.6 : 0.4

    let newX = this.pos.x + moveX * speed
    let newZ = this.pos.z + moveZ * speed

    if (!blocked(newX, newZ)) {
      this.pos.x = newX
      this.pos.z = newZ
    } else {
      newX = this.pos.x + moveX * speed
      newZ = this.pos.z
      if (!blocked(newX, newZ)) this.pos.x = newX
      newX = this.pos.x
      newZ = this.pos.z + moveZ * speed
      if (!blocked(newX, newZ)) this.pos.z = newZ
    }

    this.trail.push({ ...this.pos })

    const newDist = this.distanceTo()
    const improvement = this.prevDist - newDist
    this.prevDist = newDist

    if (newDist < this.maxProgress || this.maxProgress === 0) {
      this.maxProgress = newDist
    }

    const same = Math.abs(this.pos.x - this.lastPos.x) < 0.01 && Math.abs(this.pos.z - this.lastPos.z) < 0.01
    if (same) this.stuckSteps++
    else this.stuckSteps = 0
    this.lastPos = { ...this.pos }

    let reward = 0

    reward += improvement * 8
    reward += 0.1

    if (newDist <= REACH_DIST) {
      reward += 200
      this.done = true
    }

    if (this.stuckSteps > 10) {
      reward -= 2
    }

    if (this.stepCount >= MAX_STEPS) {
      reward -= 40
      this.done = true
    }

    if (newDist < 2) {
      reward += 50
      this.done = true
    }

    this.totalReward += reward

    return {
      state: this.getState(),
      reward,
      done: this.done,
      dist: newDist,
      steps: this.stepCount
    }
  }

  render() {
    let out = ''
    for (let row = 0; row < MAP.length; row++) {
      for (let col = 0; col < MAP[0].length; col++) {
        const wx = col * CELL + 1
        const wz = row * CELL + 1
        const dist = Math.sqrt(Math.pow(wx - this.pos.x, 2) + Math.pow(wz - this.pos.z, 2))
        const inTrail = this.trail.some(t => Math.abs(t.x - wx) < 0.6 && Math.abs(t.z - wz) < 0.6)
        if (dist < 0.6) out += '\x1b[32m@\x1b[0m'
        else if (Math.abs(wx - TARGET.x) < 0.6 && Math.abs(wz - TARGET.z) < 0.6) out += '\x1b[31mX\x1b[0m'
        else if (MAP[row][col] === 1) out += inTrail ? '\x1b[33m#\x1b[0m' : '\x1b[90m#\x1b[0m'
        else out += inTrail ? '\x1b[36m·\x1b[0m' : ' '
      }
      out += '\n'
    }
    return out
  }
}

class MovementTrainer {
  constructor() {
    this.inputSize = 10
    this.outputSize = 3
    this.hiddenSizes = [16, 12]
  }

  createBrain() {
    return new NeuralNetwork(
      [this.inputSize, ...this.hiddenSizes, this.outputSize],
      ['tanh', 'tanh', 'sigmoid']
    )
  }

  evaluate(brain, render = false) {
    const sim = new MovementSimulation()
    while (!sim.done) {
      const state = sim.getState()
      const output = brain.forward(state)
      sim.step(output)
    }
    if (render) {
      console.log(sim.render())
    }
    return {
      reward: sim.totalReward,
      finalDist: sim.distanceTo(),
      reached: sim.distanceTo() <= REACH_DIST || sim.distanceTo() < 2,
      steps: sim.stepCount,
      trail: sim.trail
    }
  }

  train(options = {}) {
    const popSize = options.populationSize || 60
    const generations = options.generations || 80
    const mutationRate = options.mutationRate || 0.35
    const eliteCount = Math.max(2, Math.floor(popSize * 0.12))

    let population = []
    for (let i = 0; i < popSize; i++) population.push(this.createBrain())

    let bestEver = null
    let bestScore = -Infinity
    const history = []

    for (let gen = 0; gen < generations; gen++) {
      const scores = population.map(brain => this.evaluate(brain, false).reward)

      const indexed = population.map((b, i) => ({ brain: b, score: scores[i] }))
      indexed.sort((a, b) => b.score - a.score)

      const topScore = indexed[0].score
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length

      if (topScore > bestScore) {
        bestScore = topScore
        bestEver = indexed[0].brain.copy()
      }

      history.push({ generation: gen + 1, best: topScore, avg: avgScore })

      const barW = 30
      const fill = Math.max(0, Math.min(barW, Math.floor((topScore + 50) / 300 * barW)))
      const bar = '\x1b[32m' + '█'.repeat(fill) + '\x1b[90m' + '░'.repeat(barW - fill) + '\x1b[0m'
      const reached = topScore > 150
      const evalR = this.evaluate(indexed[0].brain, false)
      process.stdout.write(
        `\rGen ${String(gen + 1).padStart(3)} ${bar} ` +
        `best: ${topScore.toFixed(1)} avg: ${avgScore.toFixed(1)} ` +
        `dist: ${evalR.finalDist.toFixed(1)} ` +
        `${reached ? '\x1b[32m✓ REACHED\x1b[0m' : ''}   `
      )

      const nextPop = []
      for (let i = 0; i < eliteCount; i++) nextPop.push(indexed[i].brain.copy())
      while (nextPop.length < popSize) {
        const parent = indexed[Math.floor(Math.random() * Math.min(eliteCount * 4, popSize))].brain
        const child = parent.copy()
        child.mutate(mutationRate)
        nextPop.push(child)
      }
      population = nextPop

      if (reached && gen < generations - 1) {
        const extra = Math.min(5, generations - gen - 1)
        for (let e = 0; e < extra; e++) {
          const s2 = population.map(b => this.evaluate(b, false).reward)
          const i2 = population.map((b, i) => ({ brain: b, score: s2[i] })).sort((a, b) => b.score - a.score)
          history.push({ generation: gen + 2 + e, best: i2[0].score, avg: s2.reduce((a, b) => a + b, 0) / s2.length })
          const np = []
          for (let j = 0; j < eliteCount; j++) np.push(i2[j].brain.copy())
          while (np.length < popSize) {
            const p = i2[Math.floor(Math.random() * Math.min(eliteCount * 4, popSize))].brain
            const c = p.copy()
            c.mutate(mutationRate * 0.5)
            np.push(c)
          }
          population = np
        }
        break
      }
    }

    process.stdout.write('\n')

    const finalEval = this.evaluate(bestEver || population[0], false)

    return {
      bestBrain: bestEver || population[0],
      history,
      bestScore,
      finalEval
    }
  }
}

const MODELS_DIR = path.join(__dirname, 'models')
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true })

function generateModelName() {
  const d = new Date()
  const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `movement_model_${ts}`
}

module.exports = {
  NeuralNetwork,
  MovementSimulation,
  MovementTrainer,
  MODELS_DIR,
  generateModelName,
  TARGET,
  START
}
