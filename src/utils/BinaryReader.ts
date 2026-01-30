export class BinaryReader {
  private view: DataView
  private offset: number = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
  }

  get position(): number {
    return this.offset
  }

  get remaining(): number {
    return this.view.byteLength - this.offset
  }

  get length(): number {
    return this.view.byteLength
  }

  seek(offset: number): void {
    this.offset = offset
  }

  skip(bytes: number): void {
    this.offset += bytes
  }

  readUint8(): number {
    const value = this.view.getUint8(this.offset)
    this.offset += 1
    return value
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  readInt32(): number {
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  readFloat32(): number {
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  readVec3(): { x: number; y: number; z: number } {
    return {
      x: this.readFloat32(),
      y: this.readFloat32(),
      z: this.readFloat32(),
    }
  }

  readString(length: number): string {
    const bytes = new Uint8Array(this.view.buffer, this.offset, length)
    this.offset += length
    return new TextDecoder('utf-8').decode(bytes)
  }

  readFixedString(length: number): string {
    return this.readString(length).replace(/\0+$/, '')
  }

  readChunkId(): string {
    return this.readString(4)
  }

  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = this.readFloat32()
    }
    return arr
  }

  readUint32Array(count: number): Uint32Array {
    const arr = new Uint32Array(count)
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint32()
    }
    return arr
  }

  hasMore(): boolean {
    return this.offset < this.view.byteLength
  }
}
