function generatePopulation(size) {
  const population = []
  for (let i = 0; i < size; i++) {
    population.push({
      weights: {
        explore: Math.random(),
        eat: Math.random() * 0.3,
        idle: Math.random() * 0.3,
        flee: Math.random(),
        attack: Math.random(),
        crouch: Math.random() * 0.5,
        angerDecay: Math.random() * 0.08,
        angerPerHit: Math.random() * 0.6,
        comboWindow: 500 + Math.random() * 1500,
        critChance: Math.random(),
        shieldUseChance: Math.random(),
        axeOnShieldChance: Math.random(),
        buildInstinct: Math.random(),
        buildComplexity: Math.random(),
        materialPreference: Math.random()
      }
    })
  }
  return population
}

function mutateWeights(weights, mutationRate) {
  const mutated = {}
  for (const key in weights) {
    let val
    if (key === 'comboWindow') {
      val = weights[key] + (Math.random() * 2 - 1) * mutationRate * 500
      val = Math.max(300, Math.min(2000, val))
    } else {
      val = weights[key] + (Math.random() * 2 - 1) * mutationRate
      val = Math.max(0, Math.min(1, val))
    }
    mutated[key] = val
  }
  return mutated
}

function selectTop(population, scores, percentage) {
  const agents = population.map((agent, i) => ({ agent, score: scores[i] }))
  agents.sort((a, b) => b.score - a.score)
  const count = Math.max(1, Math.floor(population.length * percentage))
  return agents.slice(0, count).map(x => x.agent)
}

function nextGeneration(population, scores, config) {
  const top = selectTop(population, scores, 0.2)
  const newPop = []
  while (newPop.length < config.populationSize) {
    const parent = top[Math.floor(Math.random() * top.length)]
    const child = JSON.parse(JSON.stringify(parent))
    child.weights = mutateWeights(child.weights, config.mutationRate)
    newPop.push(child)
  }
  return newPop
}

module.exports = { generatePopulation, mutateWeights, selectTop, nextGeneration }
