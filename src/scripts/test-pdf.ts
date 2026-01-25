import pdfParse from 'pdf-parse';

async function test() {
  console.log('Type of pdfParse:', typeof pdfParse);
  if (typeof pdfParse === 'function') {
      console.log('It is a function!');
  } else {
      console.log('It is:', pdfParse);
  }
}

test();