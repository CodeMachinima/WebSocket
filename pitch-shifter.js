class GranularPitchShifter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 16384;
    this.delay = 4096;
    this.grainSize = 2048;
    this.buffer = [new Float32Array(this.bufferSize), new Float32Array(this.bufferSize)];
    this.writeIndex = 0;
    this.samplesWritten = 0;
    this.ratio = 1;
    this.ready = false;
    this.grains = [{ phase: 0, readIndex: 0 }, { phase: 0.5, readIndex: 0 }];
    this.port.onmessage = event => {
      if (event.data && typeof event.data.ratio === 'number') {
        const wasNeutral = Math.abs(this.ratio - 1) < 0.0001;
        this.ratio = event.data.ratio;
        if (wasNeutral && Math.abs(this.ratio - 1) >= 0.0001) {
          const base = this.wrap(this.writeIndex - this.delay);
          this.grains[0].readIndex = base;
          this.grains[1].readIndex = this.wrap(base - this.grainSize * 0.5 * this.ratio);
          this.ready = this.samplesWritten >= this.delay;
        }
      }
    };
  }

  wrap(index) { return (index + this.bufferSize) % this.bufferSize; }

  sample(channel, index) {
    const source = this.buffer[Math.min(channel, this.buffer.length - 1)];
    const low = Math.floor(index), fraction = index - low;
    const a = source[this.wrap(low)], b = source[this.wrap(low + 1)];
    return a + (b - a) * fraction;
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output.length) return true;
    for (let i = 0; i < output[0].length; i++) {
      for (let channel = 0; channel < this.buffer.length; channel++) {
        const inputChannel = input[channel] || input[0];
        this.buffer[channel][this.writeIndex] = inputChannel ? inputChannel[i] : 0;
      }
      this.samplesWritten++;
      if (!this.ready && this.samplesWritten >= this.delay) {
        const base = this.wrap(this.writeIndex - this.delay);
        this.grains[0].readIndex = base;
        this.grains[1].readIndex = this.wrap(base - this.grainSize * 0.5 * this.ratio);
        this.ready = true;
      }
      for (let channel = 0; channel < output.length; channel++) {
        if (Math.abs(this.ratio - 1) < 0.0001) {
          const inputChannel = input[channel] || input[0];
          output[channel][i] = inputChannel ? inputChannel[i] : 0;
          continue;
        }
        if (!this.ready) { output[channel][i] = 0; continue; }
        let value = 0, weight = 0;
        for (const grain of this.grains) {
          const window = 0.5 - 0.5 * Math.cos(Math.PI * 2 * grain.phase);
          value += this.sample(channel, grain.readIndex) * window;
          weight += window;
          grain.readIndex = this.wrap(grain.readIndex + this.ratio);
          grain.phase += 1 / this.grainSize;
          if (grain.phase >= 1) {
            grain.phase -= 1;
            grain.readIndex = this.wrap(this.writeIndex - this.delay);
          }
        }
        output[channel][i] = weight ? value / weight : 0;
      }
      this.writeIndex = this.wrap(this.writeIndex + 1);
    }
    return true;
  }
}

registerProcessor('granular-pitch-shifter', GranularPitchShifter);
