const SUBSCRIPTION_PLANS = {
    basic: {
        id: 'basic',
        name: 'Basic',
        amount: 499900,
        currency: 'INR',
        studentLimit: 100,
        instructorLimit: 10,
        durationDays: 30,
        durationLabel: '30 days'
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        amount: 1999900,
        currency: 'INR',
        studentLimit: 500,
        instructorLimit: 50,
        durationDays: 180,
        durationLabel: '6 months'
    },
    enterprise: {
        id: 'enterprise',
        name: 'Enterprise',
        amount: 4999900,
        currency: 'INR',
        studentLimit: null,
        instructorLimit: null,
        durationDays: 365,
        durationLabel: '1 year'
    }
};

function getSubscriptionPlan(planId) {
    if (!planId) {
        return null;
    }

    const normalizedPlanId = String(planId).trim().toLowerCase();
    return SUBSCRIPTION_PLANS[normalizedPlanId] || null;
}

function listSubscriptionPlans() {
    return Object.values(SUBSCRIPTION_PLANS).map((plan) => ({ ...plan }));
}

module.exports = {
    SUBSCRIPTION_PLANS,
    getSubscriptionPlan,
    listSubscriptionPlans
};
