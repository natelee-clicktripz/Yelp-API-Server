export default function searches(term, location) {
    return `
        {
            search(term: ${term}, location:${location}, limit:10) {
                business {
                    id
                    name
                    url
                    location {
                       address1
                       address2
                       address3
                       city
                       state
                       postal_code
                       country
                       formatted_address
                    }
                    hours {
                       hours_type
                       is_open_now
                    }
                    reviews {
                       id
                    }
                }
                total
            }
        }`;
}