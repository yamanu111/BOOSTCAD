import {u16,u32,hex} from './rof.mjs';
const utf16=new TextDecoder('utf-16le');
export function odbEnd(b){const p=39+u32(b,35);if(b.length<43||hex(b.subarray(16,19))!=='020000'||p+4>b.length||p+4+u32(b,p)!==b.length)throw Error('ODBの長さが不正です');return p;}
export function associations(b){let p=odbEnd(b)+6;const result=new Map();while(p<b.length){const op=b[p++];if(!op){if(p!==b.length)throw Error('関連データ末尾が不正です');break;}if(![1,2,17,18].includes(op)||p+16>b.length)throw Error('未対応の関連形式');const tag=hex(b.subarray(p,p+16));p+=16;let n=1;if(op<3){n=u32(b,p);p+=4;}if(n>100000||p+n*16>b.length||result.has(tag))throw Error('関連データの範囲が不正です');const ids=[];for(let i=0;i<n;i++,p+=16)ids.push(hex(b.subarray(p,p+16)));result.set(tag,ids);}return result;}
export function stringAt(b,p,end=odbEnd(b)){const n=u32(b,p);if(n>4096||p+4+n*2>end)throw Error('文字列の範囲が不正です');return {text:utf16.decode(b.subarray(p+4,p+4+n*2)),after:p+4+n*2,end};}
export function parameters(b){const end=odbEnd(b),n=u32(b,57),result={};if(n>5000||73+n*72>end)throw Error('部品パラメータ一覧が不正です');const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  for(let i=0;i<n;i++){const p=73+i*72,type=u16(b,p),name=new TextDecoder().decode(b.subarray(p+24,p+56)).split('\0')[0].toUpperCase(),offset=u32(b,p+56),len=u32(b,p+60);if(!/^[A-Z_][A-Z0-9_]*$/.test(name))throw Error('パラメータ名が不正です');
    if(u32(b,p+4)||u32(b,p+8)){result[name]={unsupportedArray:true};continue;}
    if(type===12){if(57+offset+len>end||len%2)throw Error('部品の文字列が不正です');result[name]=utf16.decode(b.subarray(57+offset,57+offset+len)).split('\0')[0];}
    else result[name]=[2,3,4,5].includes(type)?v.getFloat64(p+16,true):v.getInt32(p+16,true);
  }return result;
}
// Explicit layouts measured in the two source versions, including optional UUID metadata.
export function elementInfo(b,cls,kind){const end=odbEnd(b);let at=kind==='wall'?[53,57].find(p=>hex(b.subarray(p,p+16))===cls):kind==='window'?61:59;if(at===undefined||hex(b.subarray(at,at+16))!==cls)throw Error('未対応の部材形式');
  const version=u16(b,at+(kind==='wall'?20:kind==='window'?24:22));let frame=at+(kind==='wall'?30:kind==='window'?34:32);
  if(version===3){if(u32(b,frame+16)!==98||!b.subarray(frame,frame+16).every(x=>x===0)||!b.subarray(frame+20,frame+122).every(x=>x===0))throw Error('未対応の部材メタデータ');frame+=kind==='wall'?122:kind==='window'?130:126;}else if(version!==2)throw Error('未対応の部材基本版');
  const signature=kind==='object'?'080100':'070100';if(hex(b.subarray(frame,frame+3))!==signature)throw Error('部材IDヘッダーが不正です');
  let textAt;if(kind==='wall'){if(![0,1].includes(b[frame+23])||b[frame+23]!==b[frame+29])throw Error('未対応の壁関連ID設定');textAt=frame+(b[frame+23]?57:35);}else textAt=frame+(kind==='window'?112:121);
  const info=stringAt(b,textAt,end);return {...info,frame,version,dimensions:kind==='object'?frame+38:kind==='window'?frame+28:info.after};
}
