// utils/validateAuthoritySignupData.js
const validate = require('validator');

const validateAuthoritySignupData = (req) => {
    const {
        name, email, role, otherRole, departmentName, otherDepartment,
        assignedState, assignedDistrict, idProofUrl, organizationName
    } = req.body;

    // 1. Added 'other' to allowed roles
    const allowedRoles = ['official', 'ngo', 'other'];

    if (!name || name.trim().length < 4) {
        throw new Error('Name must be at least 4 characters long');
    }
    if (!email || !validate.isEmail(email)) {
        throw new Error('Enter a valid Email ID');
    }
    if (!role || !allowedRoles.includes(role)) {
        throw new Error("Role must be 'official', 'ngo', or 'other'");
    }

    // 2. Custom Role Check
    if (role === 'other' && (!otherRole || otherRole.trim().length < 2)) {
        throw new Error("Please specify your custom role");
    }

    if (role === 'ngo' && (!organizationName || organizationName.trim().length < 2)) {
        throw new Error("Organization/NGO Name is required for NGOs");
    }
    if (!departmentName) {
        throw new Error('Department Focus is required');
    }
    if (departmentName === 'OTHER' && (!otherDepartment || otherDepartment.trim().length === 0)) {
        throw new Error('Please specify your custom department');
    }
    if (!assignedState) {
        throw new Error('Assigned State is required');
    }
    if (!assignedDistrict) {
        throw new Error('Assigned District is required');
    }
    if (!idProofUrl || !validate.isURL(idProofUrl)) {
        throw new Error('Valid ID Proof / Registration Document URL is required');
    }

    return true;
};

module.exports = validateAuthoritySignupData;