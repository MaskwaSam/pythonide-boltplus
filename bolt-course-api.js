/* Course commands over one captured BOLT+ connection session. */
'use strict';
class BoltCourseApi {
  constructor(connection, { sensorTimeoutMs = 10000, motionTimeoutMs = 120000, cleanupTimeoutMs = 1000 } = {}) {
    Object.assign(this, { connection, sensorTimeoutMs, motionTimeoutMs, cleanupTimeoutMs });
    this.operations = new Set();
    this.streams = new WeakMap();
    this.uncertainDistance = new WeakMap();
    this.uncertainAnimation = new WeakMap();
  }
  abortError(reason) {
    const error = new Error(typeof reason === 'string' ? reason : reason?.message || 'Robot operation cancelled.');
    error.name = 'AbortError';
    return error;
  }
  cancelAll(reason = 'Robot operation cancelled.') {
    const active = [...this.operations];
    for (const operation of active) operation.controller.abort(reason);
    return Promise.allSettled(active.map(operation => operation.done));
  }
  drain() {
    return Promise.allSettled([...this.operations].map(operation => operation.done));
  }
  async run(options, action) {
    const signal = options?.signal;
    if (signal?.aborted) throw this.abortError(signal.reason);
    const connection = this.connection, toy = connection.requireToy(), sdk = connection.sdk;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const session = { toy, sdk, controller, done };
    this.operations.add(session);
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(this.abortError(controller.signal.reason));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    aborted.catch(() => {});
    session.wait = promise => Promise.race([promise, aborted]);
    session.check = () => {
      if (controller.signal.aborted) throw this.abortError(controller.signal.reason);
      if (connection.sdk !== sdk || connection.toy !== toy) throw this.abortError('Robot connection changed.');
    };
    session.command = operation => {
      session.check();
      return session.wait(connection.command(operation, sdk, toy));
    };
    try { return await action(session); }
    finally {
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', onAbort);
      this.operations.delete(session);
      resolveDone();
    }
  }
  assertMovementReady() {
    const { toy, sdk } = this.connection;
    if (toy && this.uncertainDistance.get(toy) === sdk) throw new Error('Reconnect BOLT+ before moving again.');
  }
  heading(value) {
    if (!Number.isFinite(value) || value < 0 || value > 359) throw new Error('Heading must be between 0 and 359 degrees.');
    return value;
  }
  rgb(value) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) throw new Error('Color must contain three RGB bytes (0–255).');
    return [...value];
  }
  async set_heading(degrees, options = {}) {
    const heading = this.heading(degrees);
    this.assertMovementReady();
    return this.run(options, async session => {
      await session.command(toy => toy.driveControl.setHeading(heading));
      session.check();
      this.connection.heading = heading;
    });
  }
  async stop_roll(heading = null, options = {}) {
    if (heading !== null) this.heading(heading);
    return this.run(options, async session => {
      const stoppedHeading = heading === null ? this.connection.heading : heading;
      await session.command(toy => toy.driveControl.rollStop(stoppedHeading));
      session.check();
      this.connection.heading = stoppedHeading;
    });
  }
  async set_main_led(color, options = {}) {
    const rgb = this.rgb(color);
    return this.run(options, async session => {
      await session.command(toy => this.connection.writeColor(toy, ...rgb));
      session.check();
      this.connection.lastColor = rgb;
    });
  }
  async set_display_text(text, foreground, background, font = 0, options = {}) {
    const fg = this.rgb(foreground), bg = this.rgb(background);
    if (typeof text !== 'string') throw new Error('Display text must be a string.');
    if (font !== 0 && font !== 1) throw new Error('Display font must be numeric 0 or 1.');
    return this.run(options, session => {
      if (!session.toy.hasCommand?.('setDisplayText')) throw new Error('Display text is not supported by this robot SDK.');
      return session.command(toy => toy.setDisplayText(text.replace(/\\n/g, '\n'), ...fg, ...bg, font === 0 ? 'font_1' : 'font_2'));
    });
  }
  command(name, args, options = {}) {
    return this.run(options, session => {
      if (!session.toy.hasCommand?.(name)) throw new Error(`${name} is not supported by this robot SDK.`);
      return session.command(toy => toy[name](...args));
    });
  }
  set_display_color(color, options = {}) {
    return this.command('setDisplayColor', this.rgb(color), options);
  }
  clear_display(options = {}) {
    return this.command('clearDisplay', [], options);
  }
  set_display_rotation(degrees, options = {}) {
    if (![0, 90, 180, 270].includes(degrees)) throw new Error('Display rotation must be 0, 90, 180 or 270.');
    return this.command('setDisplayRotation', [`rotated_${degrees}`], options);
  }
  set_live_sensor_data(sensor, options = {}) {
    if (![1, 2, 4, 8, 16, 32, 64, 128].includes(sensor)) throw new Error('Choose one supported live sensor mask.');
    return this.command('setDisplayLiveSensorData', [sensor], options);
  }
  set_display_image(id, options = {}) {
    return this.set_display_animation(this.displayAsset(id, 'images'), false, options, true);
  }
  displayAsset(value, kind) {
    if (typeof value !== 'string') return value;
    const assets = window.BoltDisplayLibrary?.[kind];
    let asset = assets?.find(asset => asset.id === value);
    if (!asset) throw new Error(`Unknown built-in ${kind === 'images' ? 'image' : 'animation'}: ${value}. Use the Emoji + animations library. Custom GIF uploads are not supported.`);
    if (asset.choices) {
      const selected = asset.choices[Math.floor(Math.random() * asset.choices.length)];
      asset = assets.find(asset => asset.id === selected);
    }
    if (!Number.isInteger(asset?.fwid)) throw new Error('Display asset has no firmware ID.');
    return asset.fwid;
  }
  async set_display_animation(id, looping = true, options = {}, image = false) {
    if (!image) id = this.displayAsset(id, 'animations');
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new Error('Display asset ID must be a whole number from 0 to 65535.');
    if (typeof looping !== 'boolean') throw new Error('Looping must be a boolean.');
    // Static images share the firmware asset command but have no animation end.
    if (looping || image) return this.command('setAnimationIdAndLooping', [id, looping], options);
    return this.run(options, async session => {
      const toy = session.toy, event = toy.EVENT?.ANIMATION_COMPLETE_ASYNC;
      if (!toy.hasCommand?.('setAnimationIdAndLooping') || !toy.hasCommand?.('enableAnimationCompleteAsyncs') || event == null) throw new Error('Animation completion is not supported by this robot SDK.');
      if (this.uncertainAnimation.get(toy) === session.sdk) throw new Error('Reconnect BOLT+ before waiting for another non-looping animation.');
      if (this.animationPending) throw new Error('A non-looping animation is already running.');
      this.animationPending = true;
      let resolveEnd, dispatched = false;
      const end = new Promise(resolve => { resolveEnd = resolve; });
      const onEnd = packet => { if (dispatched && packet?.success === true && packet.data?.animationId === id) resolveEnd(); };
      toy.on(event, onEnd);
      try {
        await session.command(toy => toy.enableAnimationCompleteAsyncs(true));
        dispatched = true;
        await session.command(toy => toy.setAnimationIdAndLooping(id, false));
        await this.bounded(session.wait(end), 30000, 'Animation completion timed out.');
        session.check();
      } catch (error) {
        // Completion packets carry an asset ID but no request ID. An old
        // interrupted playback cannot be mistaken for a later play of that ID.
        if (dispatched) this.uncertainAnimation.set(toy, session.sdk);
        throw error;
      } finally {
        toy.off(event, onEnd);
        this.animationPending = false;
        try { await this.bounded(toy.enableAnimationCompleteAsyncs(false), this.cleanupTimeoutMs, 'Animation cleanup timed out.'); } catch (_) { /* Preserve original error. */ }
      }
    });
  }
  async set_led(position, color, options = {}) {
    const rgb = this.rgb(color);
    const positions = { front: ['frontCenter'], back: ['rearCenter'], left: ['frontLeft', 'rearLeft'], right: ['frontRight', 'rearRight'] }[position];
    if (!positions) throw new Error('Unknown LED position.');
    return this.run(options, session => {
      const values = {};
      for (const name of positions) for (const [index, channel] of ['Red', 'Green', 'Blue'].entries()) {
        const mask = session.toy.LED?.[name + channel];
        if (!Number.isInteger(mask) || mask <= 0) throw new Error(`${position} LEDs are not supported by this robot SDK.`);
        values[mask] = rgb[index];
      }
      return session.command(toy => toy.ledControl.setLeds(values));
    });
  }
  async roll_to_distance(degrees, rawSpeed, distanceCm, options = {}) {
    const heading = this.heading(degrees);
    if (!Number.isInteger(rawSpeed) || rawSpeed < 0 || rawSpeed > 255) throw new Error('Raw speed must be a byte (0–255).');
    if (!Number.isFinite(distanceCm) || distanceCm < 0) throw new Error('Distance must be finite nonnegative centimetres.');
    const distanceMeters = distanceCm * 0.01;
    if (!Number.isFinite(Math.fround(distanceMeters)) || (distanceCm > 0 && Math.fround(distanceMeters) === 0)) throw new Error('Distance is outside the robot float32 range.');
    if (distanceCm !== 0 && rawSpeed === 0) throw new Error('A nonzero distance requires a nonzero speed.');
    this.assertMovementReady();
    if (this.motion) throw new Error('A distance move is already running.');
    const motion = {};
    this.motion = motion;
    try { return await this.run(options, async session => {
      const { toy, sdk } = session;
      if (this.uncertainDistance.get(toy) === sdk) throw new Error('Reconnect BOLT+ before another distance move.');
      let dispatched = false, primaryError, stopError, timer;
      const endEvent = toy.EVENT?.REACHED_END_DRIVE_TO_DISTANCE_ASYNC;
      const responseEvent = toy.EVENT?.RESPONSE?.DRIVE_DISTANCE_AT_YAW_NORMALIZED;
      if (distanceCm !== 0 && (!toy.hasCommand?.('driveDistanceAtYawNormalized') || endEvent == null || responseEvent == null || typeof toy.on !== 'function' || typeof toy.off !== 'function')) throw new Error('Distance driving is not supported by this robot SDK.');
      let resolveEnd, rejectEnd, acknowledged = false, reachedEnd = false;
      const ended = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
      ended.catch(() => {});
      const complete = () => { if (acknowledged && reachedEnd) resolveEnd(); };
      const onEnd = event => {
        if (event?.success === true && event.data?.success === true) { reachedEnd = true; complete(); }
        else rejectEnd(new Error('BOLT+ did not complete the requested distance.'));
      };
      const onResponse = event => {
        if (event?.success === true) { acknowledged = true; complete(); }
        else rejectEnd(new Error('BOLT+ rejected the distance command.'));
      };
      if (distanceCm !== 0) {
        toy.on(endEvent, onEnd);
        toy.on(responseEvent, onResponse);
      }
      try {
        if (distanceCm !== 0) {
          timer = setTimeout(() => rejectEnd(new Error('Distance driving timed out.')), this.motionTimeoutMs);
          session.check();
          dispatched = true;
          // Edu converts public heading to native yaw once and cm to metres.
          // Raw speed bypasses percent scaling and minimum-speed remapping.
          await session.command(toy => toy.driveDistanceAtYawNormalized(-heading, rawSpeed, distanceMeters));
          await session.wait(ended);
          session.check();
        }
        this.connection.heading = heading;
      } catch (error) {
        primaryError = error;
      } finally {
        clearTimeout(timer);
        if (distanceCm !== 0) {
          toy.off(endEvent, onEnd);
          toy.off(responseEvent, onResponse);
        }
        try {
          // The captured proxy can only target the old toy, never its replacement.
          await this.bounded(toy.driveControl.rollStop(heading), this.cleanupTimeoutMs, 'Distance stop timed out.');
        } catch (error) {
          stopError = error;
          try { this.connection.diagnose?.('distance stop failed', error); } catch (_) { /* Diagnostics are optional. */ }
        }
      }
      if (!primaryError) {
        try { session.check(); } catch (error) { primaryError = error; }
      }
      // Async firmware end packets have no request ID. Never reuse an uncertain
      // session: a delayed old packet could otherwise finish a later move.
      if ((dispatched && primaryError) || stopError) this.uncertainDistance.set(toy, sdk);
      if (primaryError) {
        if (stopError) {
          primaryError.stopError = stopError;
          primaryError.message += ` Stop failed: ${stopError.message || stopError}.`;
        }
        throw primaryError;
      }
      if (stopError) throw new Error(`BOLT+ could not stop: ${stopError.message || stopError}. Reconnect BOLT+ before another distance move.`, { cause: stopError });
    }); } finally {
      if (this.motion === motion) this.motion = null;
    }
  }
  bounded(promise, milliseconds, message) {
    let timer;
    return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]).finally(() => clearTimeout(timer));
  }
  acquireLightStream(session, name = 'AmbientLight') {
    const { toy, sdk } = session;
    let streams = this.streams.get(toy);
    if (!streams) { streams = new Map(); this.streams.set(toy, streams); }
    let stream = streams.get(name);
    const previous = stream;
    if (!stream || stream.closing) {
      stream = { users: 0, owned: false, toy, sdk, name };
      streams.set(name, stream);
      stream.ready = (async () => {
        if (previous?.closing) await previous.closing;
        const enabled = await this.bounded(toy.sensorControl.getEnabledSensors(), this.sensorTimeoutMs, 'Sensor configuration timed out.');
        if (!Array.isArray(enabled)) throw new Error('The SDK did not report enabled sensors.');
        if (stream.users === 0 || this.connection.sdk !== sdk || this.connection.toy !== toy) throw this.abortError('Robot light request cancelled before sensor setup.');
        stream.owned = !enabled.includes(name);
        // A proxy promise confirms dispatch, never measurement.
        await this.bounded(toy.sensorControl.enable([name]), this.sensorTimeoutMs, 'Light sensor could not start.');
      })();
      stream.ready.catch(() => {});
    }
    stream.users++;
    return stream;
  }
  async releaseLightStream(stream) {
    if (--stream.users !== 0) return;
    try { await stream.ready; } catch (_) { /* Enable may have partly succeeded. */ }
    if (stream.users !== 0) return;
    // A new lease waits for this close before it reads/enables sensors. Keeping
    // the close promise prevents delayed old disables from retiring a new lease.
    stream.closing = (async () => {
      if (stream.owned) {
        try {
          await this.bounded(stream.toy.sensorControl.disable([stream.name]), this.cleanupTimeoutMs, 'Light sensor cleanup timed out.');
        } catch (_) { /* Preserve measurement/cancellation error. */ }
      }
    })();
    await stream.closing;
    const streams = this.streams.get(stream.toy);
    if (streams?.get(stream.name) === stream) streams.delete(stream.name);
  }

  timeout(options) {
    const milliseconds = options.timeoutMs ?? this.sensorTimeoutMs;
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 60000) throw new Error('Sensor timeout must be greater than 0 and at most 60 seconds.');
    return milliseconds;
  }
  async get_ambient_light(options = {}) {
    return this.readSensor('AmbientLight', reading => {
      const value = reading?.ambientLight ?? reading?.light;
      // The supplied BOLT+ v2 parser has NO isValid field. Some other SDK
      // parsers do; honor an explicit invalid flag without requiring one.
      return reading?.isValid !== false && Number.isFinite(value) && value >= 0 ? value : undefined;
    }, options, true);
  }
  async get_sensor_data(sensor, options = {}) {
    const spec = {
      accelerometer: ['Accelerometer', ['x', 'y', 'z']],
      gyroscope: ['Gyroscope', ['x', 'y', 'z']],
      orientation: ['Attitude', ['pitch', 'roll', 'yaw']],
      locator: ['Locator', ['x', 'y']],
      velocity: ['Velocity', ['x', 'y']]
    }[sensor];
    if (!spec) throw new Error('Unsupported sensor name.');
    return this.readSensor(spec[0], reading => {
      if (!reading || reading.isValid === false || !spec[1].every(key => Number.isFinite(reading[key]))) return undefined;
      return Object.fromEntries(spec[1].map(key => [key, reading[key]]));
    }, options);
  }
  async readSensor(name, parse, options = {}, stop = false) {
    const timeoutMs = this.timeout(options);
    return this.run(options, async session => {
      if (stop) await session.command(toy => toy.driveControl.rollStop(this.connection.heading));
      session.check();
      const control = session.toy.sensorControl;
      if (!control?.EVENT?.DATA_READY || typeof control.on !== 'function' || typeof control.off !== 'function') throw new Error(`${name} streaming is not supported by this robot SDK.`);
      let accept = false, resolvePacket, stream;
      const packet = new Promise(resolve => { resolvePacket = resolve; });
      const onData = data => {
        if (!accept || session.controller.signal.aborted) return;
        const value = parse(data?.[name]);
        if (value !== undefined) resolvePacket(value);
      };
      control.on(control.EVENT.DATA_READY, onData);
      try {
        stream = this.acquireLightStream(session, name);
        await session.wait(stream.ready);
        session.check();
        accept = true;
        const message = name === 'AmbientLight' ? 'No fresh valid ambient light reading arrived. Check that BOLT+ is awake and reconnect, then try again.' : `No fresh valid ${name} reading arrived.`;
        const value = await this.bounded(session.wait(packet), timeoutMs, message);
        session.check();
        return value;
      } finally {
        control.off(control.EVENT.DATA_READY, onData);
        if (stream) await this.releaseLightStream(stream);
      }
    });
  }
  async get_battery_percentage(options = {}) {
    return this.run(options, async session => {
      const toy = session.toy, event = toy.EVENT?.RESPONSE?.GET_BATTERY_PERCENTAGE;
      if (!toy.hasCommand?.('getBatteryPercentage') || event == null) throw new Error('Battery readings are not supported by this robot SDK.');
      let resolvePacket, rejectPacket;
      const packet = new Promise((resolve, reject) => { resolvePacket = resolve; rejectPacket = reject; });
      packet.catch(() => {});
      const onData = result => {
        if (result?.success === false) { rejectPacket(new Error('BOLT+ rejected the battery reading.')); return; }
        const value = result?.data?.percentage;
        if (result?.success === true && Number.isFinite(value) && value >= 0 && value <= 100) resolvePacket(value);
      };
      toy.on(event, onData);
      try {
        await session.command(toy => toy.getBatteryPercentage());
        const value = await this.bounded(session.wait(packet), this.sensorTimeoutMs, 'Battery reading timed out.');
        session.check();
        return value;
      } finally { toy.off(event, onData); }
    });
  }
}
window.BoltCourseApi = BoltCourseApi;
