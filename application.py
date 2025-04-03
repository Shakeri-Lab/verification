from flask import Flask, render_template, request, redirect, url_for, session
import json
import os
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client('s3')
S3_BUCKET = 'verification-user-files'

app = Flask(__name__)
app.secret_key = 'random_secret_key'  # Replace with something secure

# Load the original diagnoses→group mapping
with open('./reduced_diagnoses.json', 'r') as f:
    diagnoses_data = json.load(f)

# Group diagnoses by group name
grouped_data = {}
for diagnosis, group in diagnoses_data.items():
    grouped_data.setdefault(group, []).append(diagnosis)

# Convert to a list for easy iteration: [ (groupName, [diag1, diag2, ...]), ... ]
group_list = [(g, grouped_data[g]) for g in grouped_data]


def get_verified_filename():
    computing_id = session.get('computing_id')
    if not computing_id:
        return None
    return f"{computing_id}_verified_groups.json"



def load_verified_groups():
    key = get_verified_filename()
    if not key:
        return {}

    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return json.loads(obj['Body'].read().decode('utf-8'))
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            return {}
        else:
            raise e



def save_verified_groups(verified_data):
    key = get_verified_filename()
    if not key:
        return

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(verified_data, indent=2),
        ContentType='application/json'
    )


@app.route('/', methods=['GET', 'POST'])
def index():
    """
    Main page:
      - If GET and no computing_id in session, show form to enter computing ID.
      - If POST, save computing_id in session and reset current_index to 0.
      - If computing_id is set, show the current group for verification.
    """
    if request.method == 'POST':
        # User submitted their computing ID
        computing_id = request.form.get('computing_id', '').strip()
        if computing_id:
            session['computing_id'] = computing_id
            # reset the index each time we set a new computing_id
            session['current_index'] = 0
        return redirect(url_for('index'))

    # GET request
    computing_id = session.get('computing_id')
    if not computing_id:
        # No computing ID yet → show a simple form
        return render_template('index.html', computing_id=None)

    # If we already have a computing ID, proceed with group verification flow
    if 'current_index' not in session:
        session['current_index'] = 0

    current_index = session['current_index']

    # If we've shown all groups, go to done page
    if current_index >= len(group_list):
        return redirect(url_for('done'))

    # Get the current group's data
    group_name, diagnoses = group_list[current_index]
    return render_template(
        'index.html',
        computing_id=computing_id,
        group_name=group_name,
        diagnoses=diagnoses,
        current_index=current_index,
        total_groups=len(group_list)
    )


@app.route('/verify', methods=['POST'])
def verify():
    """
    Handles the form submission for verifying a group:
      - If user says 'yes', optionally rename the group and store in verified file.
      - If user says 'no', do nothing with that group.
      - Then move on to the next group.
    """
    # Make sure we have a computing_id
    computing_id = session.get('computing_id')
    if not computing_id:
        return redirect(url_for('index'))

    current_index = session.get('current_index', 0)
    if current_index >= len(group_list):
        return redirect(url_for('done'))

    user_response = request.form.get('group_valid')  # 'yes' or 'no'
    new_group_name = request.form.get('new_group_name', '').strip()

    original_group_name, diagnoses = group_list[current_index]

    if user_response == 'yes':
        # If user gave a new name, use it; otherwise keep the original name
        final_name = new_group_name if new_group_name else original_group_name

        # Load existing verified data, update, then save
        verified_data = load_verified_groups()
        verified_data[final_name] = diagnoses
        save_verified_groups(verified_data)

    # If user says 'no', do nothing (don't save this group)
    # Move to the next group
    session['current_index'] = current_index + 1
    return redirect(url_for('index'))


@app.route('/done')
def done():
    """
    When all groups are processed, show a summary of verified results.
    Also provide a link to reset.
    """
    computing_id = session.get('computing_id')
    if not computing_id:
        # If no computing ID, redirect to index
        return redirect(url_for('index'))

    verified_data = load_verified_groups()
    return render_template('done.html', verified_groupings=verified_data)


@app.route('/reset')
def reset():
    """
    Page explaining the reset option, with a link to actually clear data
    or go back to the main page.
    """
    return render_template('reset.html')


@app.route('/clear_data')
def clear_data():
    computing_id = session.get('computing_id')
    key = get_verified_filename()
    session.clear()

    if key:
        try:
            s3.delete_object(Bucket=S3_BUCKET, Key=key)
        except ClientError:
            pass

    return redirect(url_for('index'))



if __name__ == "__main__":
    app.run(debug=True)



application = app
