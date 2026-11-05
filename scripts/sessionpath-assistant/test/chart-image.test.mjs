import test from 'node:test';
import assert from 'node:assert/strict';
import {chartImageDimensions,normalizeChartImage} from '../../../docs/assistant-chat.mjs';

function png(width,height){const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10],0);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return bytes;}
function jpeg(width,height){const bytes=new Uint8Array(23);bytes.set([255,216,255,192,0,17,8]);const view=new DataView(bytes.buffer);view.setUint16(7,height);view.setUint16(9,width);return bytes;}
function webp(width,height){const bytes=new Uint8Array(30);bytes.set([...Buffer.from('RIFF')],0);bytes.set([...Buffer.from('WEBPVP8X')],8);for(let i=0;i<3;i++){bytes[24+i]=((width-1)>>(8*i))&255;bytes[27+i]=((height-1)>>(8*i))&255;}return bytes;}
function fakeDocument({width=4000,height=2000,encoded='data:image/jpeg;base64,/9j/2Q=='}={}){const state={closed:0,draws:[],encodings:[]},canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage:(...args)=>state.draws.push(args)}),toDataURL:(mime,quality)=>{state.encodings.push({mime,quality});return encoded;}};return {state,canvas,document:{defaultView:{createImageBitmap:async()=>({width,height,close:()=>state.closed++})},createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}};}

test('native image dimensions are verified before decoding and excessive pixels are rejected',()=>{
 assert.deepEqual(chartImageDimensions(png(1920,1080),'image/png'),{width:1920,height:1080});assert.deepEqual(chartImageDimensions(jpeg(1920,1080),'image/jpeg'),{width:1920,height:1080});assert.deepEqual(chartImageDimensions(webp(1920,1080),'image/webp'),{width:1920,height:1080});assert.throws(()=>chartImageDimensions(png(4096,4096),'image/png'),/16 megapixels/);assert.throws(()=>chartImageDimensions(png(1920,1080),'image/jpeg'),/valid PNG/);assert.throws(()=>chartImageDimensions(new Uint8Array([1,2,3]),'image/png'),/valid PNG/);
});
test('normalization draws only pixels to a 2048-edge JPEG and releases the decoded bitmap',async()=>{
 const env=fakeDocument(),bytes=png(4000,2000),file={type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes.buffer};const output=await normalizeChartImage(file,env);assert.equal(output.width,2048);assert.equal(output.height,1024);assert.match(output.dataUrl,/^data:image\/jpeg;base64,/);assert.equal(env.state.closed,1);assert.deepEqual(env.state.draws[0].slice(1),[0,0,2048,1024]);assert.equal(env.state.encodings[0].mime,'image/jpeg');
});
test('unsupported files, over-10-MB files and oversized normalized payloads fail without an upload',async()=>{
 const env=fakeDocument(),bytes=png(1000,500);await assert.rejects(normalizeChartImage({type:'image/svg+xml',size:20},env),/PNG, JPEG or WebP/);await assert.rejects(normalizeChartImage({type:'image/png',size:10*1024*1024+1},env),/10 MB/);const huge=fakeDocument({encoded:'data:image/jpeg;base64,'+'A'.repeat(1572864)});await assert.rejects(normalizeChartImage({type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes.buffer},huge),/still too large/);assert.equal(huge.state.encodings.length,3);assert.equal(huge.state.closed,1);
});
