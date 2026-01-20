const checkIssueFlags = (req) => {
    try {
        const { flag } = req.params;
        if (!flag) {
            return null
        }
        const sanitizedFlag = flag.toUpperCase();
        const allowedFlags = ['SPAM', 'INAPPROPRIATE', 'DUPLICATE', 'ALREADY RESOLVED', 'SEXUAL CONTENT', 'ABUSE', 'OTHER'];
        if (allowedFlags.includes(sanitizedFlag)) {
            return sanitizedFlag;
        }
        return null;
    }
    catch (err) {
        console.log(err);
        throw new Error("Error in handling flags");
    }
}

module.exports = checkIssueFlags