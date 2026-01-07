const express = require('express');
const app = express();
const PORT = 1111;
app.use("/", (req, res) => {
    res.send("hello");
})



app.listen(PORT, () => {
    console.log(`Server is ONLINE at PORT : ${PORT}`);
})