import { describe, expect, it } from "vitest";
import { encodeMonoWav, messageFromError, normalizeAudio, validateAudio, validatePhoto } from "./media";
import { toReviewedAssembly } from "./adapters";
import { editableGuide, editableParts } from "./editor-validation";
import { STARTER_GUIDES } from "./catalog";

describe("local media validation",()=>{
  it("accepts only supported photo formats",()=>{
    expect(validatePhoto(new File(["photo"],"photo.png",{type:"image/png"}))).toBeNull();
    expect(validatePhoto(new File(["photo"],"photo.svg",{type:"image/svg+xml"}))).toMatch(/JPEG/);
  });
  it("rejects empty and oversized photos",()=>{
    expect(validatePhoto(new File([],"empty.jpg",{type:"image/jpeg"}))).toMatch(/10 MB/);
    expect(validatePhoto(new File([new Uint8Array(10*1024*1024+1)],"large.jpg",{type:"image/jpeg"}))).toMatch(/10 MB/);
  });
  it("accepts supported audio and rejects video masquerading as audio",()=>{
    expect(validateAudio(new File(["audio"],"clip.webm",{type:"audio/webm;codecs=opus"}))).toBeNull();
    expect(validateAudio(new File(["audio"],"clip.mp4",{type:"video/mp4"}))).toMatch(/audio file/);
  });
  it("rejects empty and oversized audio",()=>{
    expect(validateAudio(new File([],"empty.wav",{type:"audio/wav"}))).toMatch(/15 MB/);
    expect(validateAudio(new File([new Uint8Array(15*1024*1024+1)],"large.wav",{type:"audio/wav"}))).toMatch(/15 MB/);
  });
  it("preserves actionable backend validation errors",()=>expect(messageFromError({data:"Consent is required."})).toBe("Consent is required."));
  it("encodes verifiable 16-bit mono WAV with bounded sample values",()=>{
    const buffer=encodeMonoWav(new Float32Array([-2,0,2]),16000);
    const view=new DataView(buffer);
    expect(buffer.byteLength).toBe(50);
    expect(String.fromCharCode(...new Uint8Array(buffer,0,4))).toBe("RIFF");
    expect(view.getUint32(24,true)).toBe(16000);
    expect(view.getUint32(40,true)).toBe(6);
    expect(view.getInt16(44,true)).toBe(-32768);
    expect(view.getInt16(48,true)).toBe(32767);
  });
  it("preserves bounded browser WebM recordings when client decoding is unavailable",async()=>{
    const file=new File(["recording"],"note.webm",{type:"audio/webm"});
    expect(await normalizeAudio(file,2)).toEqual({file,duration:2});
  });
  it("never lets unsupported originals or overlong recordings through the conversion fallback",async()=>{
    await expect(normalizeAudio(new File(["x"],"note.ogg",{type:"audio/ogg"}),2)).rejects.toThrow("could not prepare");
    await expect(normalizeAudio(new File(["x"],"note.webm",{type:"audio/webm"}),61)).rejects.toThrow("60 seconds");
  });
});
describe("review boundaries",()=>{
  it("does not upgrade unreviewed or malformed assembly data",()=>{
    expect(toReviewedAssembly({url:"/a.glb",reviewed:false,parts:[]})).toBeUndefined();
    expect(toReviewedAssembly({url:"/a.glb",reviewed:true,parts:[{id:"a",label:"A",description:"A",nodeNames:["A"],explodeOffset:[1,2]}]})).toBeUndefined();
  });
  it("retains exact reviewed part offsets",()=>{
    expect(toReviewedAssembly({url:"/a.glb",reviewed:true,parts:[{id:"a",label:"A",description:"A",nodeNames:["A"],explodeOffset:[1,2,3]}]})?.parts[0].explodeOffset).toEqual([1,2,3]);
  });
  it("allows starter drafts but never saves published content through the draft editor",()=>{
    expect(editableGuide.safeParse(STARTER_GUIDES[0]).success).toBe(true);
    expect(editableGuide.safeParse({...STARTER_GUIDES[0],status:"published"}).success).toBe(false);
    expect(editableParts.safeParse([{id:"a",label:"a",description:"a",nodeNames:["a"],explodeOffset:[0,1]}]).success).toBe(false);
  });
});
