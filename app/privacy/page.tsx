import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Wheel Deals Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Effective Date: April 6, 2026</p>

        <div className="space-y-8 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
            <p>
              Wheel Deals ("we," "our," or "us") values your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use the Wheel Deals mobile application and website.
            </p>
            <p className="mt-2">
              By using the app, you agree to the collection and use of information in accordance with this policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
            <p className="mb-2">We may collect the following types of information:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Personal Information:</strong> Email address (if you create an account or contact us).</li>
              <li><strong>Location Data:</strong> Approximate location to show nearby deals and businesses. We only access this with your permission.</li>
              <li><strong>Usage Data:</strong> App interactions (such as browsing deals, redemptions, and activity) and device information (such as device type, operating system, and app version).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
            <p className="mb-2">We use your information to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Provide and improve the app experience</li>
              <li>Show relevant local deals and businesses</li>
              <li>Process deal redemptions</li>
              <li>Communicate with users if needed</li>
              <li>Maintain app security and prevent abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Payments</h2>
            <p>
              Wheel Deals uses third-party payment providers (such as Stripe) to process transactions. We do not store your payment details. Payment information is handled securely by these providers in accordance with their own privacy policies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Sharing</h2>
            <p className="mb-2"><strong>We do not sell your personal data.</strong></p>
            <p className="mb-2">We may share limited information with:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Service providers:</strong> Such as hosting, analytics, and payment processing partners who assist us in operating the app.</li>
              <li><strong>Merchants:</strong> Only necessary details related to deal redemption (e.g., verifying a valid deal unlock).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Security</h2>
            <p>
              We take reasonable measures to protect your information. Data is transmitted securely using encryption where applicable. However, no method of transmission over the internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Your Rights</h2>
            <p className="mb-2">You may request:</p>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li>Access to your data</li>
              <li>Correction of your data</li>
              <li>Deletion of your data</li>
            </ul>
            <p>
              To make a request, please contact us at: <a href="mailto:support@wheeldealsapp.com" className="text-blue-600 hover:underline">support@wheeldealsapp.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Children's Privacy</h2>
            <p>
              Wheel Deals is not intended for children under 13. We do not knowingly collect personal information from children. If we become aware that we have collected personal data from a child under 13, we will take steps to delete that information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted within the app or on our website. Your continued use of the app after any changes indicates your acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at: <br />
              <a href="mailto:support@wheeldealsapp.com" className="text-blue-600 hover:underline font-medium">support@wheeldealsapp.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
