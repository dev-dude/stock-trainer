const express = require('express')
const app = express()

const fs = require('fs');
const request = require('request');
const parse = require('csv-parse');
const bodyParser = require('body-parser');
const stockRsi = require('technicalindicators').RSI;
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'))




let csvData=[];
let priceData=[];
let count = 0;
let csvAllRows = [];
let stockRSIValues = [];
let intialRun = true;
let firstRunData = {};
let isBuy = true;
let testData = [45.15,46.26,46.5,46.23,46.08,46.03,46.83,47.69,47.54,49.25,49.23,48.2,47.57,47.61,48.08,47.21,46.76,46.68,46.21,47.47,47.98,47.13,46.58,46.03,46.54,46.79,45.83,45.93,45.8,46.69,47.05,47.3,48.1,47.93,47.03,47.58,47.38,48.1,48.47,47.6,47.74,48.21,48.56,48.15,47.81,47.41,45.66,45.75,45.07,43.77,43.25,44.68,45.11,45.8,45.74,46.23,46.81,46.87,46.04,44.78,44.58,44.14,45.66,45.89,46.73,46.86,46.95,46.74,46.67,45.3,45.4,45.54,44.96,44.47,44.68,45.91,46.03,45.98,46.32,46.53,46.28,46.14,45.92,44.8,44.38,43.48,44.28,44.87,44.98,43.96,43.58,42.93,42.46,42.8,43.27,43.89,45,44.03,44.37,44.71,45.38,45.54];
let rsiTestData = [54.09,59.90,58.20,59.76,52.35,52.82,56.94,57.47,55.26,57.51,54.80,51.47,56.16,58.34,56.02,60.22,56.75,57.38,50.23,57.06,61.51,63.69,66.22,69.16,70.73,67.79,68.82,62.38,67.59,67.59];
function parseData(res) {
    fs.createReadStream("./test.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        //console.log(csvrow[4]);
        //console.log(csvrow[0])
        //do something with csvrow
        
        if (intialRun) {
            csvAllRows.push(csvrow);
        }
        let timeStamp = new Date(csvrow[0]).getTime();
        let csvObj = [timeStamp,parseFloat(csvrow[4]),count];
        if (count > 0) {
            csvData.push(csvObj);       
            priceData.push(parseFloat(csvrow[4]));
        }
        count++;
    })
    .on('end',function() {
      //do something wiht csvData
      console.log("done");
      //console.log(priceData);
     
      /*
      let stockRsiResult = stockRsi.calculate({
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3,
        values:priceData});
        priceData=[];
        */
        stockRSIValues = [];
        console.log(priceData.length);
        let stockRsiResult = stockRsi.calculate({
            period: 14,
            values:priceData});
            priceData=[];

        let sendRsiData = [];
       let z = 0;
       //console.log(stockRsiResult);
       console.log(stockRsiResult.length);
      
       for (;z < stockRsiResult.length ; z++) {
        //console.log(stockRsiResult[z]);
       
        if (z > 13) {
            let last14 = stockRsiResult.slice(z-14,z);
            //console.log(last14);
      
            let max = Math.max.apply(null, last14);
            let min = Math.min.apply(null, last14);
            //console.log(min);
            //console.log(max);
           // console.log(last14[last14.length-1]);
           // console.log(stockRsiResult[z-1]);
            let stochRSI = (last14[last14.length-1] - min) / (max - min);
            //console.log(stochRSI.toFixed(2));
            stockRSIValues.push(stochRSI.toFixed(2));

          
            let roundNumber = Math.round(stochRSI * 10) / 10;
            //console.log(roundNumber);
            sendRsiData.push([csvData[z+14][0],roundNumber]);
        }
       
      }
      

      //console.log(csvData);
      intialRun = false;
      firstRunData = {csvData:csvData,rsiData:sendRsiData};
      res.send(firstRunData);
    });
}

function downloadCsv(response) {
    let dest = process.cwd() + "\\test.csv";
    request.get({
        headers: {
          'Cookie': 'B=b9ihaitdim360&b=3&s=8m'
        },
        uri: 'http://query1.finance.yahoo.com/v7/finance/download/SPY?period1=946699258&period2=9529548208&interval=1d&events=history&crumb=HbK4LWmmHjG',
        method: 'GET'
      }, function(err, res, body) {     
        console.log(err);
        //console.log(body);
        fs.writeFile(dest, body, function(err) {
            if(err) {
                return console.log(err);
            }
            //console.log(res);
            console.log("The file was saved!");
            parseData(response);
        }); 
    });
}

function addData(data,res) {
    let i =0;
    let dataRow = [];
    let isBuyBeforeChange = isBuy;
    let adjustedClose = [];



    for (; i < csvAllRows.length; i++) {

        // seed initial columns
        if (i === 0) {
            // Buy
            csvAllRows[i][7] = "Gains";
            csvAllRows[i][8] = "Multi Day Gains";
            csvAllRows[i][9] = "SMA Gains";
            csvAllRows[i][10] = "Stoch RSI";
            csvAllRows[i][11] = "Single Day Volume";
            csvAllRows[i][12] = "Buy";
            continue;
        }

        if (csvAllRows[i][0] === data.time) {
            console.log("isBuy:" + isBuy);
            if (isBuy) {
                csvAllRows[i][12] = 1;
                isBuy = false;
            } else {
                csvAllRows[i][12] = -1;
                isBuy = true;
            }
            dataRow = csvAllRows[i];
        } else {
            csvAllRows[i][7] = "";
            csvAllRows[i][8] = "";
            csvAllRows[i][9] = "";
            csvAllRows[i][10] = "";
            csvAllRows[i][11] = "";
            csvAllRows[i][12] = "0";
        }

        let calcMovingAverage = [];
        if (i > 1) {
            let singleDayVolume = ((csvAllRows[i][6] - csvAllRows[i-1][6]) / csvAllRows[i-1][6]);
            let singleDayGains = ((csvAllRows[i][5] - csvAllRows[i-1][5]) / csvAllRows[i-1][5]);
            csvAllRows[i][7] = singleDayGains.toFixed(3); 
            csvAllRows[i][11] = singleDayVolume.toFixed(3)
            if (i > 2) {
                let multiDayGains = ((csvAllRows[i][5] - csvAllRows[i-2][5]) / csvAllRows[i-2][5]);
                csvAllRows[i][8] = multiDayGains.toFixed(3);
                if (i > 3) {
                    let smaGains = ((parseFloat(csvAllRows[i][7]) + parseFloat(csvAllRows[i-1][7]) +  parseFloat(csvAllRows[i-2][7])) / 3);
                    csvAllRows[i][9] = smaGains.toFixed(3);
                }
            }
        }

        if (i > 28 && stockRSIValues[i-29]) {
            let roundNumber = Math.round(stockRSIValues[i-29] * 10) / 10;
            csvAllRows[i][10] = parseFloat(roundNumber);
        }
    }
   let convertedRows = "";
   let x = 0;
   for (; x < csvAllRows.length; x++) {

    convertedRows += csvAllRows[x][0] + "," +  csvAllRows[x][7] + "," + csvAllRows[x][8] + "," + csvAllRows[x][9] +
     "," + csvAllRows[x][10] + "," + csvAllRows[x][11] + "," + csvAllRows[x][12] + "\n";
   }

    if (convertedRows.length > 0) {
        fs.writeFile('public/testout.csv', convertedRows, 'utf8', function (err) {
            if (err) {
            console.log(err);
            console.log('Some error occured - file either not saved or corrupted file saved.');
            res.send({msg:"error",data:dataRow,isBuy:isBuyBeforeChange});
            } else{
            console.log('It\'s saved!');
            res.send({msg:"saved",data:dataRow,isBuy:isBuyBeforeChange});
            }
        });
    } else {
        res.send({msg:"error",data:dataRow,isBuy:isBuyBeforeChange});
    }
}


app.get('/', function(req, res) {
    // if (firstRunData.csvData) {
    //   res.send(firstRunData);
    //} else {
        csvData=[];
        priceData=[];
        count = 0;
        csvAllRows = [];
        stockRSIValues = [];
        intialRun = true;
        firstRunData = {};
        downloadCsv(res);
   // }
});
app.post('/save', function(req, res) {
    addData(req.body,res);
});


app.listen(3000, () => console.log('Example app listening on port 3000!'))