const convertOmittedAddress = (address)  => `${address.slice(0, 5)}...${address.slice(-4)}`;
module.exports = { convertOmittedAddress }