export default function weather(location) {
    return `http://api.openweathermap.org/data/2.5/forecast?q=${location}&units=imperial&appid=c72e4713fe0727f04204579e819c0b17`
}