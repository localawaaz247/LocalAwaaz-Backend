const checkUserUpdates = (req) => {
    const { name, password, profilePic, country, state, city, pinCode } = req.body;
    const allowedUpdates = ['name', 'password', 'profilePic', 'country', 'state', 'city', 'pinCode'];
    if (!allowedUpdates.includes(req.body)) {
        throw new Error('Invalid update request');
    }
    
}