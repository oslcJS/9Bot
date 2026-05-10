const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { EventEmitter } = require('events')

const MODULES_DIR = path.join(__dirname, 'modules')
const MODULE_STATE_FILE = path.join(__dirname, 'data', 'module_state.json')

class ModuleBridge extends EventEmitter {
  constructor(bot) {
    super()
    this.bot = bot
    this.processes = {}
    this.activeModules = {}
    this.moduleStates = {}
    this._loadState()
    this._pendingRequests = {}
    this._reqId = 0
    this._stateCache = {}
  }

  _loadState() {
    try {
      if (fs.existsSync(MODULE_STATE_FILE)) {
        this.moduleStates = JSON.parse(fs.readFileSync(MODULE_STATE_FILE, 'utf8'))
      }
    } catch (e) {
      this.moduleStates = {}
    }
  }

  _saveState() {
    try {
      const dir = path.dirname(MODULE_STATE_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(MODULE_STATE_FILE, JSON.stringify(this.moduleStates, null, 2))
    } catch (e) { }
  }

  isModuleActive(name) {
    return this.moduleStates[name] !== false
  }

  setModuleActive(name, active) {
    this.moduleStates[name] = active
    this._saveState()
    if (this.processes[name]) {
      this._sendJson(name, { type: 'command', command: 'set_active', args: { active } })
    }
  }

  listModules() {
    if (!fs.existsSync(MODULES_DIR)) return []
    return fs.readdirSync(MODULES_DIR)
      .filter(f => f.endsWith('.py') && f !== 'NB.py' && f !== '__init__.py')
      .map(f => {
        const name = f.replace('.py', '')
        return {
          name,
          file: f,
          active: this.isModuleActive(name),
          running: !!this.processes[name]
        }
      })
  }

  loadModule(name) {
    if (this.processes[name]) return

    const moduleFile = path.join(MODULES_DIR, name + '.py')
    if (!fs.existsSync(moduleFile)) {
      this.emit('error', `Module not found: ${name}`)
      return
    }

    const python = process.platform === 'win32' ? 'python' : 'python3'
    const proc = spawn(python, [moduleFile], {
      cwd: MODULES_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    this.processes[name] = proc
    this.activeModules[name] = true

    let buffer = ''
    proc.stdout.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          this._handleMessage(name, JSON.parse(line))
        } catch (e) {
          this.emit('log', name, `Parse error: ${e.message}`)
        }
      }
    })

    proc.stderr.on('data', (data) => {
      this.emit('log', name, `[stderr] ${data.toString().trim()}`)
    })

    proc.on('exit', (code) => {
      this.emit('log', name, `Process exited (code: ${code})`)
      delete this.processes[name]
      delete this.activeModules[name]
    })

    this._sendJson(name, {
      type: 'init',
      module: name
    })

    this.emit('module_loaded', name)
    return name
  }

  unloadModule(name) {
    if (this.processes[name]) {
      this.processes[name].kill()
      delete this.processes[name]
    }
    delete this.activeModules[name]
    this.emit('module_unloaded', name)
  }

  reloadModule(name) {
    this.unloadModule(name)
    setTimeout(() => this.loadModule(name), 100)
  }

  _sendJson(name, obj) {
    if (this.processes[name] && this.processes[name].stdin.writable) {
      this.processes[name].stdin.write(JSON.stringify(obj) + '\n')
    }
  }

  _handleMessage(name, msg) {
    const type = msg.type

    if (type === 'response' || type === 'request') {
      if (type === 'request') {
        this._handleRequest(name, msg)
      }
      return
    }

    switch (type) {
      case 'init':
        this.emit('module_init', name, msg.module)
        break

      case 'log':
        this.emit('log', name, msg.message || '')
        break

      case 'control':
        this._handleControl(name, msg.control, msg.value)
        break

      case 'command':
        this._handleCommand(name, msg.command, msg.args || {})
        break

      default:
        this.emit('message', name, msg)
    }
  }

  _handleRequest(name, msg) {
    const rid = msg.id
    const method = msg.method
    const params = msg.params || {}

    switch (method) {
      case 'get_model_path': {
        const modelPath = path.join(__dirname, 'models', `module_${params.name || 'default'}.json`)
        this._sendJson(name, { type: 'response', id: rid, result: modelPath })
        break
      }
      case 'save_model': {
        try {
          const modelPath = path.join(__dirname, 'models', `module_${params.name || 'default'}.json`)
          if (!fs.existsSync(path.dirname(modelPath))) fs.mkdirSync(path.dirname(modelPath), { recursive: true })
          fs.writeFileSync(modelPath, JSON.stringify(params.data || {}))
          this._sendJson(name, { type: 'response', id: rid, result: { saved: true, path: modelPath } })
        } catch (e) {
          this._sendJson(name, { type: 'response', id: rid, result: { saved: false, error: e.message } })
        }
        break
      }
      case 'load_model': {
        try {
          const modelPath = path.join(__dirname, 'models', `module_${params.name || 'default'}.json`)
          if (fs.existsSync(modelPath)) {
            const data = JSON.parse(fs.readFileSync(modelPath, 'utf8'))
            this._sendJson(name, { type: 'response', id: rid, result: data })
          } else {
            this._sendJson(name, { type: 'response', id: rid, result: null })
          }
        } catch (e) {
          this._sendJson(name, { type: 'response', id: rid, result: null })
        }
        break
      }
      case 'train_module': {
        this.emit('train', name, params)
        this._sendJson(name, { type: 'response', id: rid, result: { status: 'training_started' } })
        break
      }
      default:
        this._sendJson(name, { type: 'response', id: rid, result: null })
    }
  }

  _handleControl(name, control, value) {
    if (!this.bot || !this.bot.entity) return
    this.emit('control', name, control, value)
  }

  _handleCommand(name, command, args) {
    if (!this.bot) return

    switch (command) {
      case 'set_active':
        this.moduleStates[name] = args.active
        this._saveState()
        break

      case 'set_movement':
        if (this.bot.entity) {
          this.bot.setControlState('forward', args.forward > 0.5)
          this.bot.setControlState('back', args.forward < -0.5)
          this.bot.setControlState('left', args.strafe < -0.5)
          this.bot.setControlState('right', args.strafe > 0.5)
          this.bot.setControlState('jump', args.jump)
          this.bot.setControlState('sprint', args.sprint)
          this.bot.setControlState('sneak', args.sneak)
        }
        break

      case 'look_at':
        if (this.bot.entity) {
          this.bot.lookAt(
            require('vec3')(args.x, args.y, args.z),
            true
          )
        }
        break

      case 'chat':
        if (this.bot.chat) {
          this.bot.chat(String(args.message))
        }
        break

      case 'spin':
        if (this.bot.entity) {
          this.bot.setControlState('sprint', true)
          this.bot.setControlState('forward', true)
          this.bot.setControlState('jump', true)
          const dir = args.direction === 'left'
          this.bot.setControlState('left', dir)
          this.bot.setControlState('right', !dir)
          setTimeout(() => {
            if (this.bot && this.bot.entity) {
              this.bot.setControlState('left', false)
              this.bot.setControlState('right', false)
              this.bot.setControlState('forward', false)
              this.bot.setControlState('jump', false)
              this.bot.setControlState('sprint', false)
            }
          }, (args.duration || 1.0) * 1000)
        }
        break

      case 'set_state':
        this._stateCache[args.key] = args.value
        this.emit('module_state', name, args.key, args.value)
        break
    }
  }

  broadcastState(botState) {
    const msg = JSON.stringify({ type: 'state', data: botState })
    for (const [name, proc] of Object.entries(this.processes)) {
      if (proc.stdin.writable) {
        try {
          proc.stdin.write(msg + '\n')
        } catch (e) { }
      }
    }
  }

  sendEvent(event, data) {
    const msg = JSON.stringify({ type: 'event', event, data })
    for (const [name, proc] of Object.entries(this.processes)) {
      if (proc.stdin.writable) {
        try {
          proc.stdin.write(msg + '\n')
        } catch (e) { }
      }
    }
  }

  unloadAll() {
    for (const name of Object.keys(this.processes)) {
      this.unloadModule(name)
    }
  }
}

module.exports = { ModuleBridge, MODULES_DIR }
