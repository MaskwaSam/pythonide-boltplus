/* Small adapter around the Sphero SDK supplied with this project. */
'use strict';
class BoltConnection {
  constructor(onState, onDiagnostic = () => {}) {
    this.onState = onState;
    this.onDiagnostic = onDiagnostic;
    this.sdk = null;
    this.toy = null;
    this.state = 'disconnected';
    this.heading = 0;
    this.lastColor = [0, 0, 0];
    this.pendingConnection = null;
    this.maintenance = null;
  }

  update(state, name = '') {
    this.state = state;
    this.onState(state, name);
  }

  async initialize() {
    if (!window.isSecureContext) throw new Error('BOLT+ needs HTTPS or localhost.');
    if (!navigator.bluetooth) throw new Error('Use Chrome or Edge with Web Bluetooth enabled.');
    if (!window.SpheroSDK) throw new Error('The Sphero SDK is missing. Keep the vendor folder with this page.');
    const sdk = window.SpheroSDK({
      workerPath: new URL('vendor/sphero/toybox.js', document.baseURI).href,
      debug: false,
      sendActivationData: false
    });
    this.sdk = sdk;
    try {
      await this.withTimeout(sdk.init(), 20000, 'The Sphero SDK could not start. Reload the page and try again.');
    } catch (error) {
      await this.dispose(sdk);
      throw error;
    }
    if (this.sdk !== sdk) throw new Error('Connection attempt cancelled.');
    const box = sdk.toybox;
    box.on(box.EVENT.TOY_READY, event => {
      if (this.sdk !== sdk || !this.pendingConnection) return;
      const pending = this.pendingConnection;
      const toy = event.toy;
      this.toy = toy;
      // The SDK's TOY_READY event follows notification setup and robot initialization.
      pending.resolve(toy);
    });
    box.on(box.EVENT.READY_TOY_FAILED, error => this.connectionFailed(sdk, error));
    const dropped = error => {
      if (this.sdk !== sdk) return;
      this.diagnoseTransportLoss(error);
      this.connectionFailed(sdk, new Error('BOLT+ disconnected. Shake it awake, then connect again.'));
      // Rebuild notifications, proxy objects, and GATT handles on the next attempt.
      void this.dispose(sdk);
    };
    box.on(box.EVENT.TOY_PUT_AWAY, dropped);
    // Base events also report a cancelled chooser and failures before TOY_READY.
    for (const event of [sdk.EVENT.ERROR, sdk.EVENT.OPERATION_FAILED, sdk.EVENT.CONNECTION_FAILED, sdk.EVENT.USER_CANCELLED]) {
      sdk.on(event, error => {
        if (this.sdk !== sdk) return;
        this.diagnose(event, error);
        this.connectionFailed(sdk, error || new Error('Connection cancelled.'));
        // ERROR also carries worker command errors; OPERATION_FAILED can mean
        // an unsupported platform operation. Neither alone proves BLE loss.
        if (event === sdk.EVENT.CONNECTION_FAILED || this.isTransportFailure(error)) dropped(error);
      });
    }
    return sdk;
  }

  diagnose(event, error) {
    const detail = {};
    for (const key of ['name', 'message', 'operation', 'opperation', 'robotID']) {
      const value = error?.[key];
      if (typeof value === 'string' || typeof value === 'number') detail[key] = String(value).slice(0, 400);
    }
    if (typeof error === 'string') detail.message = error.slice(0, 400);
    // Keep SDK envelopes bounded and omit Bluetooth identifiers and device data.
    try { this.onDiagnostic(`${String(event).slice(0, 80)}: ${JSON.stringify(detail).slice(0, 1000)}`); }
    catch (_) { /* Diagnostics must not interrupt robot cleanup or commands. */ }
  }

  isTransportFailure(error) {
    const message = typeof error === 'string' ? error : error?.message || '';
    return /Bluetooth device disconnected|GATT.*disconnected|(?:GATT server|Bluetooth device).*not connected|connection (?:lost|closed)|Bluetooth is not enabled|Worker crashed/i.test(message);
  }

  connectionFailed(sdk, error) {
    if (this.sdk !== sdk || !this.pendingConnection) return;
    this.pendingConnection.reject(new Error(error?.message || (typeof error === 'string' ? error : 'BOLT+ could not connect. Wake it and try again.')));
  }

  async connect() {
    if (this.state !== 'disconnected') return;
    let sdk = this.sdk;
    this.update('connecting');
    try {
      if (!sdk) sdk = await this.initialize();
      if (this.sdk !== sdk) throw new Error('Connection attempt cancelled.');
      const ready = new Promise((resolve, reject) => { this.pendingConnection = { resolve, reject }; });
      // readyToy starts the chooser itself; a second scan would open it twice.
      sdk.toybox.readyToy('BP-').catch(error => this.connectionFailed(sdk, error));
      this.toy = await this.withTimeout(ready, 90000, 'Connection timed out. Wake BOLT+ and try again.');
      this.pendingConnection = null;
      // Confirm the initialized SDK accepts a stop command before showing green.
      await this.stop();
      if (this.sdk !== sdk || !this.toy) throw new Error('Connection attempt cancelled.');
      this.update('connected', this.toy.getName());
      await this.startMaintenance(sdk, this.toy);
      if (this.sdk !== sdk || !this.toy) throw new Error('BOLT+ disconnected while connecting. Wake it and try again.');
    } catch (error) {
      await this.dispose(sdk);
      throw error;
    }
  }

  diagnoseTransportLoss(error) {
    this.diagnose('transport lost', error);
    const session = this.maintenance;
    if (session) {
      const age = session.lastBatteryReply === null ? 'none' : `${Date.now() - session.lastBatteryReply}ms`;
      this.diagnose('session timing', { message: `connected ${Date.now() - session.started}ms; last battery reply age ${age}` });
    }
  }

  stopMaintenance() {
    const session = this.maintenance;
    this.maintenance = null;
    if (!session) return;
    clearTimeout(session.pollTimer);
    clearTimeout(session.responseTimer);
    for (const [event, handler] of session.listeners) {
      try { session.toy.off(event, handler); }
      catch (error) { this.diagnose('maintenance listener cleanup failed', error); }
    }
  }

  startMaintenance(sdk, toy) {
    if (this.sdk !== sdk || this.toy !== toy) return;
    this.stopMaintenance();
    const session = { sdk, toy, started: Date.now(), lastBatteryReply: null, listeners: [], pollTimer: null, responseTimer: null, request: null, pingPending: false };
    this.maintenance = session;
    const active = () => this.maintenance === session && this.sdk === sdk && this.toy === toy;
    // ToyProxy methods dispatch commands; only RESPONSE confirms a battery read.
    if (typeof toy.on !== 'function' || typeof toy.off !== 'function') return;
    const listen = (event, handler) => {
      if (!active()) return;
      toy.on(event, handler);
      session.listeners.push([event, handler]);
    };
    const schedulePoll = () => {
      if (!active()) return;
      clearTimeout(session.pollTimer);
      session.pollTimer = setTimeout(pollBattery, 10000);
    };
    const pollBattery = () => {
      if (!active() || session.request) return;
      const request = {};
      session.request = request;
      session.responseTimer = setTimeout(() => {
        if (!active() || session.request !== request) return;
        session.request = null;
        this.diagnose('battery reply missing', { message: 'No battery response within 6000ms; retrying in 10000ms.' });
        schedulePoll();
      }, 6000);
      return this.command(toy => toy.getBatteryPercentage(), sdk, toy).catch(error => {
        if (!active()) return;
        this.diagnose('battery dispatch failed', error);
        if (session.request === request) {
          session.request = null;
          clearTimeout(session.responseTimer);
          schedulePoll();
        }
      });
    };
    let initialDispatch;
    const responseEvent = toy.EVENT?.RESPONSE?.GET_BATTERY_PERCENTAGE;
    if (toy.hasCommand?.('getBatteryPercentage') && responseEvent != null) {
      listen(responseEvent, event => {
        if (!active() || !session.request) return;
        if (event?.success !== true || !Number.isFinite(event.data?.percentage)) return;
        session.request = null;
        session.lastBatteryReply = Date.now();
        clearTimeout(session.responseTimer);
        schedulePoll();
      });
      initialDispatch = pollBattery();
    }
    const sleepEvent = toy.EVENT?.WILL_SLEEP_NOTIFY;
    if (toy.hasCommand?.('ping') && sleepEvent != null) {
      listen(sleepEvent, () => {
        if (!active() || session.pingPending) return;
        session.pingPending = true;
        void this.command(toy => toy.ping(), sdk, toy).catch(error => {
          if (active()) this.diagnose('sleep ping failed', error);
        }).finally(() => {
          if (active()) session.pingPending = false;
        });
      });
    }
    return initialDispatch;
  }

  requireToy() {
    if (!this.toy) throw new Error('Connect BOLT+ before running robot commands.');
    return this.toy;
  }

  withTimeout(promise, milliseconds, message, code) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(message); error.code = code; reject(error); }, milliseconds); })
    ]).finally(() => clearTimeout(timer));
  }

  async command(operation, sdk = this.sdk, toy = this.requireToy()) {
    if (this.sdk !== sdk || this.toy !== toy) throw new Error('Connection attempt cancelled.');
    try {
      return await this.withTimeout(operation(toy), 6000, 'BOLT+ stopped responding. Reconnect the robot.', 'BOLT_COMMAND_TIMEOUT');
    } catch (error) {
      if (this.sdk === sdk) {
        this.diagnose('command failed', error);
        if (error?.code === 'BOLT_COMMAND_TIMEOUT' || this.isTransportFailure(error)) {
          this.diagnoseTransportLoss(error);
          await this.dispose(sdk);
        }
      }
      throw error;
    }
  }

  writeColor(toy, r, g, b) {
    // ToyProxy returns a function for unknown names: use advertised capability,
    // not typeof, before choosing the legacy single-main-LED command.
    if (toy.hasCommand?.('setMainLed')) return toy.setMainLed(r, g, b);
    // BOLT+ MAIN follows Sphero Edu's RGB enum mapping through LED control.
    // Match real channels only; enum aliases must not become extra mask bits.
    const values = {};
    const colors = { Red: r, Green: g, Blue: b };
    for (const position of ['rearLeft', 'rearCenter', 'rearRight', 'frontRight', 'frontCenter', 'frontLeft']) {
      for (const [color, value] of Object.entries(colors)) {
        const channel = toy.LED?.[position + color];
        if (Number.isInteger(channel) && channel > 0) values[channel] = value;
      }
    }
    if (Object.keys(values).length !== 18) throw new Error('BOLT+ main LEDs are not supported by this robot SDK.');
    return toy.ledControl.setLeds(values);
  }

  async setColor(r, g, b) {
    const sdk = this.sdk, toy = this.requireToy();
    const result = await this.command(toy => this.writeColor(toy, r, g, b), sdk, toy);
    if (this.sdk === sdk && this.toy === toy) this.lastColor = [r, g, b];
    return result;
  }

  async aimStart() {
    const sdk = this.sdk, toy = this.requireToy();
    await this.command(toy => toy.driveControl.aimStart(), sdk, toy);
  }

  async aimRotate(degrees) {
    if (!Number.isFinite(degrees)) throw new Error('Aiming heading must be a finite number.');
    const sdk = this.sdk, toy = this.requireToy();
    const heading = ((degrees % 360) + 360) % 360;
    // SDK setHeading uses driveWithHeading at speed zero, never rollStart.
    await this.command(toy => toy.driveControl.setHeading(heading), sdk, toy);
  }

  async aimFinish() {
    const sdk = this.sdk, toy = this.requireToy();
    const color = [...this.lastColor];
    // Vendored aimStop already calls resetYaw: do not reset a second time.
    await this.command(toy => toy.driveControl.aimStop(), sdk, toy);
    if (this.sdk === sdk && this.toy === toy) this.heading = 0;
    await this.command(toy => toy.driveControl.setStabilization(true), sdk, toy);
    await this.command(toy => this.writeColor(toy, ...color), sdk, toy);
  }

  async aimCancel() {
    const sdk = this.sdk, toy = this.requireToy();
    const color = [...this.lastColor];
    // The SDK clears its aiming mode and resets yaw together. The UI must
    // still leave aiming unconfirmed when this cancellation path is used.
    await this.command(toy => toy.driveControl.aimStop(), sdk, toy);
    if (this.sdk === sdk && this.toy === toy) this.heading = 0;
    await this.command(toy => this.writeColor(toy, ...color), sdk, toy);
  }

  async prepareProgram() {
    const sdk = this.sdk, toy = this.requireToy();
    await this.command(toy => toy.driveControl.setStabilization(true), sdk, toy);
  }

  async drive(heading, speed) {
    this.heading = heading;
    // The classroom API uses percent; Sphero's drive control uses 0–255.
    return this.command(toy => toy.driveControl.rollStart(heading, Math.round(speed * 255 / 100)));
  }

  async stop() {
    if (!this.toy) return;
    return this.command(toy => toy.driveControl.rollStop(this.heading));
  }

  async dispose(sdk = this.sdk) {
    if (this.sdk !== sdk) return;
    this.stopMaintenance();
    const pending = this.pendingConnection;
    this.sdk = null;
    this.toy = null;
    this.pendingConnection = null;
    pending?.reject(new Error('Connection attempt cancelled.'));
    // Publish the loss before awaiting teardown; old cleanup must not overwrite
    // the status of another SDK created while teardown is finishing.
    this.update('disconnected');
    if (sdk) {
      try { await sdk.destroy(); } catch (_) { /* Worker teardown is best effort. */ }
    }
  }

  async disconnect() {
    const sdk = this.sdk;
    try { await this.stop(); }
    finally {
      await this.dispose(sdk);
    }
  }
}
window.BoltConnection = BoltConnection;
