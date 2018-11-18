import numpy
import pandas
from keras.models import Sequential
from keras.layers import Dense
from keras.layers import Dropout
from keras.layers import LSTM
from keras.wrappers.scikit_learn import KerasClassifier
from keras.utils import np_utils
from sklearn.model_selection import cross_val_score
from sklearn.model_selection import KFold
from sklearn.preprocessing import LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import jaccard_similarity_score
from flask import Flask, request
from flask_restful import Resource, Api
from json import dumps
from flask.json import jsonify

app = Flask(__name__)
api = Api(app)



# fix random seed for reproducibility
# define baseline model

def baseline_model():
	# create model
	model = Sequential()
	model.add(Dense(30, input_dim=15, init='normal', activation='relu'))
	# model.add(Dropout(10))
	model.add(Dense(2, init='normal', activation='softmax'))

	# Compile model
	# Create model
	model.compile(loss='mean_squared_error', optimizer='sgd', metrics=[])
	return model


seed = 1
numpy.random.seed(seed)

# load dataset
#Gains,Multi Day Gains,Stoch RSI,Single Day Volume,Expon Moving Avg,Triple Expon Smoothed,Bond Vol,Bond Triple,Trs Vol,Trs Expon Avg,Trs Triple,EUR Gains,EUR Vol,EUR Expon Avg,EUR Triple,Buy
dataframe = pandas.read_csv("stock-real-feb-2018.csv", header=None)
testdataframe = pandas.read_csv("test.csv", header=None)
testset_X = testdataframe.values[:,0:15].astype(float)
dataset = dataframe.values
X = dataset[:,0:15].astype(float)
Y = dataset[:,15]

# encode class values as integers
encoder = LabelEncoder()
encoder.fit(Y)
encoded_Y = encoder.transform(Y)

# convert integers to dummy variables (i.e. one hot encoded)
dummy_y = np_utils.to_categorical(encoded_Y)



'''
kfold = KFold(n_splits=2, shuffle=True, random_state=seed)
results = cross_val_score(estimator, X, dummy_y, cv=kfold)
print("Baseline: %.2f%% (%.2f%%)" % (results.mean()*100, results.std()*100))
'''

estimator = KerasClassifier(build_fn=baseline_model, epochs=10, batch_size=2000, verbose=1)
X_train, X_test, Y_train, Y_test = train_test_split(X, dummy_y, test_size=0.5, random_state=seed)
estimator.fit(X_train, Y_train)

totalDiff = 0
count = 0
for chunk in numpy.array_split(dataset, 100):
	#print(chunk)
	predictions = estimator.predict(chunk[:,0:15].astype(float))
	print(encoder.inverse_transform(predictions))
	chunkDf = chunk[:,15]
	count = count + 1
	print(jaccard_similarity_score(chunkDf, predictions))
	totalDiff += jaccard_similarity_score(chunkDf, predictions)


print(jaccard_similarity_score(chunkDf, predictions))

print(totalDiff)
print(count)
print(format(totalDiff/count, '.2f'))

@app.route('/predict', methods=['POST'])
def get():
	print(request.json)
	predictions = estimator.predict(numpy.stack( [request.json], axis=0 ).astype(float))
	print(predictions[0].tolist())
	return jsonify({"success":True,"prediction":predictions[0].tolist()})


if __name__ == '__main__':
	app.run(port='5002')