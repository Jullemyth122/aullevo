// Voice mode microphone (loaded by src/voice/listen.ts with audioWorklet.addModule).
// Collects the microphone's 128-sample blocks into 2048-sample chunks (128 ms at 16 kHz) and posts each one to
// the side panel, which decides when a spoken command starts and ends. A separate file because extension pages
// may only load scripts that ship with the extension.
class AullevoMicChunker extends AudioWorkletProcessor {
    constructor() {
        super();
        this.chunk = new Float32Array(2048);
        this.filled = 0;
    }

    process(inputs) {
        const input = inputs[0] && inputs[0][0];
        if (!input) return true;
        let offset = 0;
        while (offset < input.length) {
            const count = Math.min(input.length - offset, this.chunk.length - this.filled);
            this.chunk.set(input.subarray(offset, offset + count), this.filled);
            this.filled += count;
            offset += count;
            if (this.filled === this.chunk.length) {
                this.port.postMessage(this.chunk, [this.chunk.buffer]);
                this.chunk = new Float32Array(2048);
                this.filled = 0;
            }
        }
        return true;
    }
}

registerProcessor('aullevo-mic-chunker', AullevoMicChunker);
