const automator = require('miniprogram-automator');
(async()=>{
 const mp = await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});
 await mp.navigateTo('/pages/map/map');
 await new Promise(r=>setTimeout(r,1500));
 await mp.mockWxMethod('getLocation',{latitude:26.07518,longitude:119.1829312,accuracy:12});
 const page=await mp.currentPage();
 await page.callMethod('locateMe');
 await new Promise(r=>setTimeout(r,1200));
 console.log(JSON.stringify(await page.data()).slice(0,240));
 await mp.screenshot({path:'C:/Users/Ko_Li/.openclaw/workspace/web/_audit/campus_map_20261113/mp_location_demo.png'});
 await mp.disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
