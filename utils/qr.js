// utils/qr.js —— 二维码生成（byte 模式 / ECC-L / mask0 / 版本 1-6，零依赖）
// 逐行取自原站 index.html 的 QR 段（第 766-837 行），未做改动。
var QR_CAP=[17,32,53,78,106,134];
var QR_DCW=[19,34,55,80,108,136];
var QR_EC=[7,10,15,20,26,18];
var QR_NB=[1,1,1,1,1,2];
var QR_AL=[0,18,22,26,30,34];
function qrGen(text){
  var bytes=[];
  for(var i=0;i<text.length;i++){var cc=text.charCodeAt(i);
    if(cc<128){bytes.push(cc);}else{var e=unescape(encodeURIComponent(text[i]));for(var j=0;j<e.length;j++)bytes.push(e.charCodeAt(j));}}
  if(bytes.length>QR_CAP[5])bytes=bytes.slice(0,QR_CAP[5]);
  var v=6; for(var k=0;k<6;k++){if(bytes.length<=QR_CAP[k]){v=k+1;break;}}
  var dcp=QR_DCW[v-1],ecn=QR_EC[v-1],nb=QR_NB[v-1];
  var bits=[];function put(val,len){for(var b=len-1;b>=0;b--)bits.push((val>>b)&1);}
  put(4,4);put(bytes.length,8);
  bytes.forEach(function(by){put(by,8);});
  var capBits=dcp*8;
  for(var t=0;t<4&&bits.length<capBits;t++)bits.push(0);
  while(bits.length%8)bits.push(0);
  var pads=[0xEC,0x11],pi=0;
  while(bits.length<capBits){put(pads[pi++%2],8);}
  var data=[];for(var b2=0;b2<bits.length;b2+=8){var x=0;for(var b3=0;b3<8;b3++)x=(x<<1)|bits[b2+b3];data.push(x);}
  var AP=[1];for(var ai=0;ai<255;ai++)AP.push(qrGfMul(AP[ai],2));
  function apow(e){return AP[e%255];}
  function qrGfMul(a,b){var r=0;for(var i2=0;i2<8;i2++){if(b&1)r^=a;a<<=1;if(a&0x100)a^=0x11d;b>>=1;}return r;}
  function polyMul(p,q){var r=[];for(var i3=0;i3<p.length+q.length-1;i3++)r.push(0);
    for(var i4=0;i4<p.length;i4++)for(var j4=0;j4<q.length;j4++)r[i4+j4]^=qrGfMul(p[i4],q[j4]);return r;}
  var g=[1];for(var gi=0;gi<ecn;gi++)g=polyMul(g,[1,apow(gi)]);
  function rsEcw(blk){var msg=blk.slice();for(var z=0;z<ecn;z++)msg.push(0);
    for(var i5=0;i5<blk.length;i5++){var f=msg[i5];if(f){for(var j5=1;j5<g.length;j5++)msg[i5+j5]^=qrGfMul(f,g[j5]);}}
    return msg.slice(blk.length);}
  var blocks=[],per=dcp/nb;
  for(var bi=0;bi<nb;bi++)blocks.push(data.slice(bi*per,(bi+1)*per));
  var ecs=blocks.map(rsEcw);
  var all=[];
  for(var c=0;c<per;c++)for(var bb=0;bb<nb;bb++)all.push(blocks[bb][c]);
  for(var c2=0;c2<ecn;c2++)for(var b4=0;b4<nb;b4++)all.push(ecs[b4][c2]);
  var size=17+4*v,M=[],F=[];
  for(var r=0;r<size;r++){M.push(new Array(size).fill(0));F.push(new Array(size).fill(false));}
  function setFn(rr,cc,val){if(rr>=0&&cc>=0&&rr<size&&cc<size){M[rr][cc]=val?1:0;F[rr][cc]=true;}}
  function finder(r0,c0){for(var dr=-1;dr<=7;dr++)for(var dc=-1;dc<=7;dc++){
    var on=(dr>=0&&dr<=6&&dc>=0&&dc<=6)&&(dr===0||dr===6||dc===0||dc===6||(dr>=2&&dr<=4&&dc>=2&&dc<=4));
    setFn(r0+dr,c0+dc,on);}}
  finder(0,0);finder(0,size-7);finder(size-7,0);
  for(var ti=8;ti<size-8;ti++){setFn(6,ti,ti%2===0);setFn(ti,6,ti%2===0);}
  if(v>=2){var a=QR_AL[v-1];
    for(var dr2=-2;dr2<=2;dr2++)for(var dc2=-2;dc2<=2;dc2++)
      setFn(a+dr2,a+dc2,Math.max(Math.abs(dr2),Math.abs(dc2))!==1);}
  setFn(size-8,8,1);
  var fmd=8,remx=fmd<<10;
  for(var fi=14;fi>=10;fi--){if(remx&(1<<fi))remx^=0x537<<(fi-10);}
  var fmt=((fmd<<10)|remx)^0x5412;
  var P1=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  var P2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];
  for(var f2=0;f2<15;f2++){var bv=(fmt>>(14-f2))&1;setFn(P1[f2][0],P1[f2][1],bv);setFn(P2[f2][0],P2[f2][1],bv);}
  var idx=0,upward=true;
  for(var col=size-1;col>0;col-=2){
    if(col===6)col--;
    for(var s=0;s<size;s++){
      var rr=upward?size-1-s:s;
      for(var k2=0;k2<2;k2++){
        var cx=col-k2;
        if(!F[rr][cx]){
          var bit=idx<all.length*8?((all[idx>>3]>>(7-(idx&7)))&1):0;
          if((rr+cx)%2===0)bit^=1;
          M[rr][cx]=bit;idx++;
        }
      }
    }
    upward=!upward;
  }
  return {m:M,n:size};
}
module.exports = { qrGen: qrGen, QR_CAP: QR_CAP };
