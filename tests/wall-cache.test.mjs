import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, readElements } from '../src/elements.mjs';

const FLOOR='0312b67984ae884da9c620ead705e0bc', VRD='67e6e5e67795ca41bf4ada75b917513f';
const WALL='11'.repeat(16), LEVEL='22'.repeat(16), CACHE1='33'.repeat(16), CACHE2='44'.repeat(16);
const contour=[0,0,10,0,10,-.2,0,-.2,0,0];
const joined=[0,0,10.1,0,10,-.2,0,-.2,0,0];
const bytes=hex=>Uint8Array.from(hex.match(/../g).map(s=>parseInt(s,16)));
function record(cls,bodyEnd,links){
  const tail=[1,0];
  for(const [tag,ids] of links){
    tail.push(1,...bytes(tag),ids.length&255,ids.length>>8&255,0,0,...ids.flatMap(id=>[...bytes(id)]));
  }
  tail.push(0);
  const b=new Uint8Array(bodyEnd+4+tail.length),v=new DataView(b.buffer);
  b.set(bytes(cls));b[16]=2;v.setUint32(35,bodyEnd-39,true);v.setUint32(bodyEnd,tail.length,true);b.set(tail,bodyEnd+4);
  return {b,v};
}
function wall(ids){
  const p=130,{b,v}=record(CLASSES.wall,p+200,[[FLOOR,[LEVEL]],[VRD,ids]]);
  b.set(bytes(CLASSES.wall),53);v.setUint16(73,2,true);b.set([7,1,0],83);
  v.setUint32(118,4,true);for(const [i,c] of [...'WALL'].entries())v.setUint16(122+i*2,c.charCodeAt(0),true);
  v.setFloat64(p+16,10,true);b[p+76]=1;
  for(const [offset,value] of [[77,.2],[85,.2],[153,3],[161,.5]])v.setFloat64(p+offset,value,true);
  return {guid:WALL,cls:CLASSES.wall,data:b};
}
function polygon(coords){
  const n=coords.length/2,ep=53+(n+1)*16,limit=ep+8;
  const b=new Uint8Array(limit),v=new DataView(b.buffer);
  b.set([2,1]);v.setUint32(2,limit-6,true);b[6]=1;v.setUint16(7,31,true);
  const xs=coords.filter((_,i)=>i%2===0),ys=coords.filter((_,i)=>i%2===1);
  [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].forEach((value,i)=>v.setFloat64(9+i*8,value,true));
  v.setUint32(41,n,true);v.setUint32(49,1,true);
  coords.forEach((value,i)=>v.setFloat64(69+i*8,value,true));v.setUint32(ep+4,n,true);
  return b;
}
function cache(id,{first=contour,second=joined,parent=WALL,cls=CLASSES.vrd}={}){
  const a=polygon(first),c=polygon(second),{b}=record(cls,46+a.length+c.length,[[VRD,[parent]]]);
  b.set([1,0,1,0,3,0,0],39);b.set(a,46);b.set(c,46+a.length);
  return {guid:id,cls,data:b};
}
const read=(ids,caches)=>readElements(new Map([[WALL,wall(ids)],...caches.map(c=>[c.guid,c])]));
function volume(g){
  let sum=0;
  for(let i=0;i<g.indices.length;i+=3){
    const [a,b,c]=[...g.indices.slice(i,i+3)].map(id=>[...g.positions.slice(id*3,id*3+3)]);
    sum+=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
  }
  return sum/6;
}

test('single saved contour preserves joined ends, base, height and solid volume',()=>{
  const r=read([CACHE1],[cache(CACHE1)]);
  assert.deepEqual(r.failures,[]);assert.equal(r.objects.length,1);
  const g=r.objects[0];assert.equal(g.joined,true);assert.equal(g.floor,LEVEL);
  assert.ok(Math.abs(volume(g)-6.03)<1e-8);
  assert.equal(Math.min(...g.positions.filter((_,i)=>i%3===2)),.5);
  assert.equal(Math.max(...g.positions.filter((_,i)=>i%3===2)),3.5);
});

test('identical contours for multiple view contexts restore one wall regardless of reference order',()=>{
  const caches=[cache(CACHE1),cache(CACHE2)];
  const single=read([CACHE1],caches).objects[0];
  for(const ids of [[CACHE1,CACHE2],[CACHE2,CACHE1]]){
    const r=read(ids,caches);assert.deepEqual(r.failures,[]);assert.equal(r.objects.length,1);
    assert.deepEqual(r.objects[0].positions,single.positions);assert.deepEqual(r.objects[0].indices,single.indices);
    assert.ok(Math.abs(volume(r.objects[0])-6.03)<1e-8);
  }
});

test('conflicting joined contours are reported instead of choosing the first view',()=>{
  const changed=joined.map((v,i)=>i===2?v+1:v),caches=[cache(CACHE1),cache(CACHE2,{second:changed})];
  for(const ids of [[CACHE1,CACHE2],[CACHE2,CACHE1]]){
    const r=read(ids,caches);assert.equal(r.objects.length,0);assert.match(r.failures[0].message,/複数の壁輪郭が一致しません/);
  }
});

test('all cache references must exist, belong to the wall and have the right class',()=>{
  for(const caches of [[cache(CACHE1)], [cache(CACHE1),cache(CACHE2,{parent:LEVEL})], [cache(CACHE1),cache(CACHE2,{cls:CLASSES.lib})]]){
    const r=read([CACHE1,CACHE2],caches);assert.equal(r.objects.length,0);assert.match(r.failures[0].message,/壁輪郭との関連が一致しません/);
  }
});

test('empty or repeated cache references cannot masquerade as a valid wall',()=>{
  for(const ids of [[],[CACHE1,CACHE1]]){
    const r=read(ids,[cache(CACHE1)]);assert.equal(r.objects.length,0);assert.match(r.failures[0].message,/壁輪郭の参照が不正です/);
  }
});
