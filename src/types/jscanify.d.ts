declare module 'jscanify/client' {
  class jscanify {
    constructor();
    extractPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      resultWidth: number,
      resultHeight: number,
    ): HTMLCanvasElement;
  }
  export = jscanify;
}
