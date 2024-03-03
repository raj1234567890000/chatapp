const mongoose=require('mongoose')

const url=`mongodb://localhost:27017/chatApp`;

mongoose.connect(url,{
   // useNewUrlparser:true,
   // useUnifiedTopology:true
}).then(()=>console.log("connect to db")).catch((e)=>console.log('error',e))


