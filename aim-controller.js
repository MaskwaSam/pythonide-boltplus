/* BOLT+ aiming UI. Robot operations are supplied by the connection adapter. */
(() => {
  'use strict';

  class BoltAim {
    constructor(robot, { onMessage = () => {} } = {}) {
      this.robot = robot;
      this.onMessage = onMessage;
      this.confirmed = false;
      this.connected = false;
      this.running = false;
      this.epoch = 0;
      this.session = null;
      this.queue = Promise.resolve();
      this.button = document.createElement('button');
      this.button.id = 'boltAim';
      this.button.type = 'button';
      this.button.textContent = 'Aim BOLT+';
      this.button.disabled = true;
      document.getElementById('bolt').insertAdjacentElement('afterend', this.button);
      this.dialog = document.createElement('dialog');
      this.dialog.id = 'boltAimDialog';
      this.dialog.setAttribute('aria-labelledby', 'boltAimTitle');
      this.dialog.setAttribute('aria-describedby', 'boltAimInstructions');
      this.dialog.innerHTML = `
        <h2 id="boltAimTitle">Aim BOLT+</h2>
        <p id="boltAimInstructions">Place BOLT+ on the floor with room to turn. Rotate it until its tail light points toward you. The direction away from you will be forward in your program.</p>
        <label for="boltAimHeading">Rotate BOLT+</label>
        <div class="bolt-aim-angle"><output id="boltAimDegrees" for="boltAimHeading">0°</output></div>
        <input id="boltAimHeading" type="range" min="0" max="359" step="1" value="0" aria-valuetext="0 degrees">
        <div class="bolt-aim-turns"><button type="button" id="boltAimLeft">↶ Left 15°</button><button type="button" id="boltAimRight">Right 15° ↷</button></div>
        <p id="boltAimStatus" role="status" aria-live="polite">Starting aiming…</p>
        <p id="boltAimError" role="alert" hidden></p>
        <div class="bolt-aim-actions"><button type="button" id="boltAimRetry" hidden>Retry aiming</button><button type="button" id="boltAimCancel">Cancel</button><button type="button" id="boltAimDone" class="primary">Done</button></div>`;
      document.body.append(this.dialog);
      const style = document.createElement('style');
      style.textContent = `
        #boltAimDialog{box-sizing:border-box;width:min(430px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;margin:auto;padding:22px;border:1px solid var(--line,#d9dde4);border-radius:12px;background:var(--panel,#fff);color:var(--text,#1d2330);font:inherit;box-shadow:0 12px 48px #0005}
        #boltAimDialog::backdrop{background:#0008}
        #boltAimDialog h2{margin:0 0 12px;font-size:1.35em}
        #boltAimDialog p{margin:12px 0;overflow-wrap:anywhere}
        #boltAimDialog input[type=range]{display:block;width:100%;margin:12px 0 18px;accent-color:var(--accent,#2563eb)}
        #boltAimDialog .bolt-aim-angle{text-align:center;font-size:1.5em;font-variant-numeric:tabular-nums}
        #boltAimDialog .bolt-aim-turns{display:flex;justify-content:space-between;gap:8px}
        #boltAimDialog .bolt-aim-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:18px}
        #boltAimStatus{color:var(--muted,#5d6675);font-size:.9em}
        #boltAimError{color:#c43232}
        @media(prefers-color-scheme:dark){#boltAimError{color:#fca5a5}}
        @media(max-width:375px){#boltAimDialog{padding:16px}#boltAimDialog button{padding:8px}}
      `;
      document.head.append(style);
      const find = id => this.dialog.querySelector('#' + id);
      this.slider = find('boltAimHeading');
      this.degrees = find('boltAimDegrees');
      this.left = find('boltAimLeft');
      this.right = find('boltAimRight');
      this.done = find('boltAimDone');
      this.cancel = find('boltAimCancel');
      this.retry = find('boltAimRetry');
      this.status = find('boltAimStatus');
      this.error = find('boltAimError');
      this.button.addEventListener('click', () => { void this.open(); });
      this.slider.addEventListener('input', () => this._requestRotation(Number(this.slider.value)));
      this.left.addEventListener('click', () => this._requestRotation((Number(this.slider.value) + 345) % 360));
      this.right.addEventListener('click', () => this._requestRotation((Number(this.slider.value) + 15) % 360));
      this.done.addEventListener('click', () => { void this._finish(); });
      this.cancel.addEventListener('click', () => { void this._cancel(); });
      this.retry.addEventListener('click', () => { if (this.session) void this._start(this.session); });
      this.dialog.addEventListener('cancel', event => {
        event.preventDefault();
        void this._cancel();
      });
      // Also resolve safely if another caller closes the native dialog.
      this.dialog.addEventListener('close', () => {
        if (this.session && !this.dialog.open) void this._cancel();
      });
    }

    onConnectionState(state) {
      const connected = state === 'connected';
      if (connected !== this.connected) {
        this.epoch += 1;
        this.confirmed = false;
      }
      this.connected = connected;
      if (!connected && this.session) this._close(this.session, false);
      this._updateButton();
    }

    setRunning(running) {
      this.running = Boolean(running);
      this._updateButton();
    }

    _updateButton() {
      this.button.disabled = !this.connected || this.running || Boolean(this.session);
    }

    _valid(session) {
      return this.session === session && this.connected && session.epoch === this.epoch;
    }

    _enqueue(session, operation) {
      const result = this.queue.then(() => {
        if (!this._valid(session)) return;
        return operation();
      });
      this.queue = result.catch(() => {});
      return result;
    }

    open() {
      if (this.session) return this.session.promise;
      if (!this.connected || this.running) return Promise.resolve(false);
      const session = { epoch: this.epoch, ready: false, busy: false, pending: null, draining: null, timer: null };
      session.promise = new Promise(resolve => { session.resolve = resolve; });
      this.session = session;
      this.confirmed = false;
      this.slider.value = '0';
      this.degrees.value = '0°';
      this.slider.setAttribute('aria-valuetext', '0 degrees');
      this._clearError();
      this.retry.hidden = true;
      this._controls(false);
      this.status.textContent = 'Starting aiming…';
      this._updateButton();
      try {
        this.dialog.showModal();
      } catch (error) {
        this._report(session, error);
        this._close(session, false);
        return session.promise;
      }
      void this._start(session);
      return session.promise;
    }

    async _start(session) {
      if (!this._valid(session) || session.busy) return;
      session.busy = true;
      this.retry.hidden = true;
      this._clearError();
      try {
        await this._enqueue(session, () => this.robot.aimStart());
        if (!this._valid(session) || session.cancelling) return;
        session.ready = true;
        this.status.textContent = 'Use the slider or arrow buttons to aim, then choose Done.';
        this._controls(true);
        this.slider.focus();
      } catch (error) {
        this._report(session, error);
        if (this._valid(session)) this.retry.hidden = false;
      } finally {
        if (this._valid(session) && !session.cancelling) session.busy = false;
      }
    }

    _controls(enabled) {
      this.slider.disabled = !enabled;
      this.left.disabled = !enabled;
      this.right.disabled = !enabled;
      this.done.disabled = !enabled;
    }

    _clearError() {
      this.error.hidden = true;
      this.error.textContent = '';
    }

    _report(session, error) {
      if (!this._valid(session)) return;
      const message = 'Unable to aim BOLT+: ' + (error && error.message ? error.message : String(error));
      this.error.textContent = message;
      this.error.hidden = false;
      this.status.textContent = 'Aiming has not been confirmed.';
      try { this.onMessage(message, 'err'); } catch (_) { /* Logging must not interrupt cleanup. */ }
    }

    _requestRotation(degrees) {
      const session = this.session;
      if (!session || !session.ready || session.busy || !this._valid(session)) return;
      this.slider.value = String(degrees);
      this.degrees.value = degrees + '°';
      this.slider.setAttribute('aria-valuetext', degrees + ' degrees');
      session.pending = degrees;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => {
        session.timer = null;
        void this._drain(session).catch(error => this._report(session, error));
      }, 60);
    }

    _drain(session) {
      if (session.draining) return session.draining;
      session.draining = (async () => {
        while (this._valid(session) && session.pending !== null) {
          const degrees = session.pending;
          session.pending = null;
          try {
            await this._enqueue(session, () => this.robot.aimRotate(degrees));
          } catch (error) {
            if (this._valid(session) && session.pending === null) session.pending = degrees;
            throw error;
          }
        }
      })().finally(() => { session.draining = null; });
      return session.draining;
    }

    async _finish() {
      const session = this.session;
      if (!session || !session.ready || session.busy || !this._valid(session)) return;
      session.busy = true;
      clearTimeout(session.timer);
      this._controls(false);
      this.cancel.disabled = true;
      this._clearError();
      this.status.textContent = 'Saving forward direction…';
      try {
        await this._drain(session);
        await this._enqueue(session, () => this.robot.aimFinish());
        if (this._valid(session)) {
          this.confirmed = true;
          this._close(session, true);
        }
      } catch (error) {
        this._report(session, error);
      } finally {
        if (this._valid(session)) {
          session.busy = false;
          this._controls(true);
          this.cancel.disabled = false;
        }
      }
    }

    async _cancel() {
      const session = this.session;
      if (!session || session.cancelling || (session.busy && session.ready)) return;
      session.cancelling = true;
      session.busy = true;
      clearTimeout(session.timer);
      session.pending = null;
      this._controls(false);
      this.cancel.disabled = true;
      this.retry.hidden = true;
      this.status.textContent = 'Cancelling aiming…';
      try {
        await this._enqueue(session, () => this.robot.aimCancel());
      } catch (error) {
        this._report(session, error);
      } finally {
        if (this._valid(session)) this._close(session, false);
      }
    }

    _close(session, confirmed) {
      if (this.session !== session) return;
      clearTimeout(session.timer);
      session.pending = null;
      this.session = null;
      this.confirmed = confirmed;
      this.cancel.disabled = false;
      if (this.dialog.open) this.dialog.close();
      this._updateButton();
      session.resolve(confirmed);
      if (!this.button.disabled) this.button.focus();
    }
  }

  window.BoltAim = BoltAim;
})();
